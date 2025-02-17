// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../libs/VaultCalculator.sol";
import "../interfaces/IBribesPool.sol";
import "../interfaces/IBribesPoolFactory.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IPToken.sol";
import "../interfaces/IRedeemPool.sol";
import "../interfaces/IRedeemPoolFactory.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";
import "../tokens/PToken.sol";
import "./BriberExtension.sol";

abstract contract Vault is IVault, Pausable, ReentrancyGuard, ProtocolOwner, BriberExtension {
  using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
  using EnumerableSet for EnumerableSet.AddressSet;
  using VaultCalculator for IVault;

  bool internal _closed;

  address public immutable settings;
  IRedeemPoolFactory public redeemPoolFactory;
  IBribesPoolFactory public bribesPoolFactory;

  address public immutable assetToken;
  address public immutable pToken;
  uint8 public immutable ytDecimals;

  uint256 internal _currentEpochId;  // default to 0
  mapping(uint256 => Constants.Epoch) internal _epochs;  // epoch id => epoch info

  mapping(uint256 => uint256) internal _assetTotalSwapAmount;

  mapping(uint256 => uint256) internal _yTokenTotalSupply;  // including yTokens hold by Vault
  mapping(uint256 => mapping(address => uint256)) internal _yTokenUserBalances;

  mapping(uint256 => uint256) internal _epochNextSwapX;
  mapping(uint256 => uint256) internal _epochNextSwapK0;

  constructor(
    address _protocol,
    address _settings,
    address _redeemPoolFactory,
    address _bribesPoolFactory,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokenSymbol
  ) ProtocolOwner(_protocol) {
    require(
      _settings != address(0) && _redeemPoolFactory != address(0) && _bribesPoolFactory != address(0) && _assetToken_ != address(0),
      "Zero address detected"
    );
    require(_assetToken_ != Constants.NATIVE_TOKEN);
    uint8 assetDecimals = IERC20Metadata(_assetToken_).decimals();

    settings = _settings;
    redeemPoolFactory = IRedeemPoolFactory(_redeemPoolFactory);
    bribesPoolFactory = IBribesPoolFactory(_bribesPoolFactory);

    assetToken = _assetToken_;
    // PToken's decimals should be the same as the asset token's decimals
    pToken = address(new PToken(_protocol, _settings, _pTokenName, _pTokenSymbol, assetDecimals));
    ytDecimals = assetDecimals;
  }

  /* ================= VIEWS ================ */

  function closed() external view returns (bool) {
    return _closed;
  }

  function assetBalance() public view override whenNotClosed returns (uint256) {
    return _balanceOfUnderlyingVault();
  }

  function currentEpochId() public view returns (uint256) {
    require(_currentEpochId > 0, "No epochs yet");
    return _currentEpochId;
  }

  function epochIdCount() public view returns (uint256) {
    return _currentEpochId;
  }

  function epochIdAt(uint256 index) public view returns (uint256) {
    require(index < _currentEpochId, "Index out of bounds");
    return index + 1;
  }

  function epochInfoById(uint256 epochId) public view validEpochId(epochId) returns (Constants.Epoch memory) {
    return _epochs[epochId];
  }

  function assetTotalSwapAmount(uint256 epochId) public view validEpochId(epochId) returns (uint256) {
    return _assetTotalSwapAmount[epochId];
  }

  function yTokenTotalSupply(uint256 epochId) public view validEpochId(epochId) returns (uint256) {
    return _yTokenTotalSupply[epochId];
  }

  function yTokenUserBalance(uint256 epochId, address user) public view validEpochId(epochId) returns (uint256) {
    return _yTokenUserBalances[epochId][user];
  }

  function paramValue(bytes32 param) public view override returns (uint256) {
    return IProtocolSettings(settings).vaultParamValue(address(this), param);
  }

  function epochNextSwapX(uint256 epochId) public view returns (uint256) {
    return _epochNextSwapX[epochId];
  }

  function epochNextSwapK0(uint256 epochId) public view returns (uint256) {
    return _epochNextSwapK0[epochId];
  }

  function calcSwap(uint256 assetAmount) public view returns (uint256, uint256) {
    return IVault(this).doCalcSwap(assetAmount);
  }

  function Y() public view returns (uint256) {
    return IVault(this).calcY();
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function deposit(uint256 amount) external nonReentrant whenNotPaused whenNotClosed noneZeroAmount(amount) {
    require(amount <= IERC20(assetToken).balanceOf(_msgSender()));

    bool newEpoch = _onUserAction(amount);

    TokensTransfer.transferTokens(assetToken, _msgSender(), address(this), amount);
    _depositToUnderlyingVault(amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    uint256 pTokenSharesAmount = IPToken(pToken).mint(_msgSender(), pTokenAmount);
    emit PTokenMinted(_msgSender(), amount, pTokenAmount, pTokenSharesAmount);

    uint256 yTokenAmount = amount;
    if (!newEpoch) {
      // update X and k0 on new deposit
      require(_epochNextSwapK0[_currentEpochId] > 0);
      (uint256 X, uint256 k0) = IVault(this).updateSwapParamsOnDeposit(yTokenAmount);
      _epochNextSwapX[_currentEpochId] = X;
      _epochNextSwapK0[_currentEpochId] = k0;
    }

    // mint yToken to Vault
    _yTokenTotalSupply[_currentEpochId] = _yTokenTotalSupply[_currentEpochId] + yTokenAmount;
    _yTokenUserBalances[_currentEpochId][address(this)] = _yTokenUserBalances[_currentEpochId][address(this)] + yTokenAmount;
    emit YTokenDummyMinted(_currentEpochId, address(this), amount, yTokenAmount);

    emit Deposit(_currentEpochId, _msgSender(), amount, pTokenAmount, yTokenAmount);

    _updateStakingBribes();
  }

  function redeem(uint256 amount) external nonReentrant whenClosed noneZeroAmount(amount) {
    require(amount <= IPToken(pToken).balanceOf(_msgSender()));
    uint256 sharesAmount = IPToken(pToken).getSharesByBalance(amount);

    _redeemOnClose(amount);
    emit Redeem(_msgSender(), amount, sharesAmount);
  }

  function swap(uint256 amount) external nonReentrant whenNotPaused whenNotClosed noneZeroAmount(amount) {
    require(IERC20(pToken).totalSupply() > 0, "No principal tokens");
    require(amount <= IERC20(assetToken).balanceOf(_msgSender()));

    _onUserAction(0);

    require(_currentEpochId > 0);
    Constants.Epoch memory epoch = _epochs[_currentEpochId];
    require(block.timestamp <= epoch.startTime + epoch.duration, "Epoch ended");

    TokensTransfer.transferTokens(assetToken, _msgSender(), address(this), amount);

    uint256 fees = amount * paramValue("f2") / (10 ** IProtocolSettings(settings).decimals());
    if (fees > 0) {
      TokensTransfer.transferTokens(assetToken, address(this), IProtocolSettings(settings).treasury(), fees);
    }
    uint256 netAmount = amount - fees;
    _depositToUnderlyingVault(netAmount);

    uint256 pTokenAmount = netAmount;
    IPToken(pToken).rebase(pTokenAmount);

    _assetTotalSwapAmount[_currentEpochId] = _assetTotalSwapAmount[_currentEpochId] + netAmount;

    require(_epochNextSwapK0[_currentEpochId] > 0);
    (uint256 X, uint256 m) = calcSwap(netAmount);
    _epochNextSwapX[_currentEpochId] = X;

    uint256 yTokenAmount = m;
    require(_yTokenUserBalances[_currentEpochId][address(this)] >= yTokenAmount, "Not enough yTokens");
    _yTokenUserBalances[_currentEpochId][address(this)] = _yTokenUserBalances[_currentEpochId][address(this)] - yTokenAmount;
    _yTokenUserBalances[_currentEpochId][_msgSender()] = _yTokenUserBalances[_currentEpochId][_msgSender()] + yTokenAmount;
    
    IBribesPool stakingBribesPool = IBribesPool(_epochs[_currentEpochId].stakingBribesPool);
    stakingBribesPool.notifyYTSwappedForUser(_msgSender(), yTokenAmount);

    IBribesPool adhocBribesPool = IBribesPool(_epochs[_currentEpochId].adhocBribesPool);
    adhocBribesPool.notifyYTSwappedForUser(_msgSender(), yTokenAmount);

    emit Swap(_currentEpochId, _msgSender(), amount, fees, pTokenAmount, yTokenAmount);

    _updateStakingBribes();
  }

  function batchClaimRedeemAssets(uint256[] memory epochIds) external nonReentrant {
    for (uint256 i = 0; i < epochIds.length; i++) {
      Constants.Epoch memory epoch = _epochs[epochIds[i]];
      IRedeemPool redeemPool = IRedeemPool(epoch.redeemPool);
      redeemPool.claimAssetTokenFor(_msgSender());
    }
  }
  
  /* ========== RESTRICTED FUNCTIONS ========== */

  function close() external nonReentrant whenNotClosed onlyOwner {
    _closed = true;

    if (_currentEpochId > 0) {
      // force end current epoch
      Constants.Epoch storage currentEpoch = _epochs[_currentEpochId];
      if (block.timestamp < currentEpoch.startTime + currentEpoch.duration) {
        currentEpoch.duration = block.timestamp - currentEpoch.startTime;
        // Update AdhocBribesPool end timestamp
        IBribesPool adhocBribesPool = IBribesPool(currentEpoch.adhocBribesPool);
        adhocBribesPool.updateEpochEndTimeOnVaultClose(block.timestamp);
      }
      _onEndEpoch(_currentEpochId);
      _updateStakingBribes();
    }

    _onVaultClose();

    emit Closed();
  }

  function pause() external nonReentrant onlyOwner {
    _pause();
  }

  function unpause() external nonReentrant onlyOwner {
    _unpause();
  }

  function pauseRedeemPool(uint256 epochId) external nonReentrant validEpochId(epochId) onlyOwner {
    Constants.Epoch memory epoch = _epochs[epochId];
    IRedeemPool redeemPool = IRedeemPool(epoch.redeemPool);
    redeemPool.pause();
  }

  function unpauseRedeemPool(uint256 epochId) external nonReentrant validEpochId(epochId) onlyOwner {
    Constants.Epoch memory epoch = _epochs[epochId];
    IRedeemPool redeemPool = IRedeemPool(epoch.redeemPool);
    redeemPool.unpause();
  }

  function updateRedeemPoolFactory(address newRedeemPoolFactory) external nonReentrant onlyOwner {
    redeemPoolFactory = IRedeemPoolFactory(newRedeemPoolFactory);
  }

  function updateBribesPoolFactory(address newBribesPoolFactory) external nonReentrant onlyOwner {
    bribesPoolFactory = IBribesPoolFactory(newBribesPoolFactory);
  }

  function setBriber(address account, bool briber) external nonReentrant onlyOwner {
    _setBriber(account, briber);
  }

  function addAdhocBribes(address bribeToken, uint256 amount) external nonReentrant onlyOwnerOrBriber noneZeroAddress(bribeToken) noneZeroAmount(amount) {
    // current epoch may be ended
    uint256 epochId = _currentEpochId;
    require(epochId > 0);

    IBribesPool adhocBribesPool = IBribesPool(_epochs[epochId].adhocBribesPool);
    TokensTransfer.transferTokens(bribeToken, _msgSender(), address(this), amount);

    IERC20(bribeToken).approve(address(adhocBribesPool), amount);
    adhocBribesPool.addBribes(bribeToken, amount);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _onUserAction(uint256 deltaYTokenAmount) internal returns (bool) {
    bool newEpoch = false;
    // Start first epoch
    if (_currentEpochId == 0) {
      _startNewEpoch(deltaYTokenAmount);
      newEpoch = true;
    }
    else {
      Constants.Epoch memory currentEpoch = _epochs[_currentEpochId];
      if (block.timestamp > currentEpoch.startTime + currentEpoch.duration) {
        _onEndEpoch(_currentEpochId);
        _startNewEpoch(deltaYTokenAmount);
        newEpoch = true;
      }
    }

    return newEpoch;
  }

  function _onEndEpoch(uint256 epochId) internal {
    Constants.Epoch memory epoch = _epochs[epochId];
    IRedeemPool redeemPool = IRedeemPool(epoch.redeemPool);
    _settleRedeemPool(redeemPool);
  }

  function _startNewEpoch(uint256 deltaYTokenAmount) internal {
    uint256 oldEpochId = _currentEpochId;

    _currentEpochId = _currentEpochId + 1;
    uint256 epochId = _currentEpochId;

    _epochs[epochId].epochId = epochId;
    _epochs[epochId].startTime = block.timestamp;
    _epochs[epochId].duration = paramValue("D");
    _epochs[epochId].redeemPool = redeemPoolFactory.createRedeemPool(address(this));
    _epochs[epochId].stakingBribesPool = bribesPoolFactory.createStakingBribesPool(address(this));
    _epochs[epochId].adhocBribesPool = bribesPoolFactory.createAdhocBribesPool(address(this), _epochs[epochId].startTime + _epochs[epochId].duration);

    emit EpochStarted(epochId, block.timestamp, paramValue("D"), _epochs[epochId].redeemPool, _epochs[epochId].stakingBribesPool, _epochs[epochId].adhocBribesPool);

    if (oldEpochId > 0) {
      uint256 yTokenAmount = IERC20(pToken).totalSupply();
      _yTokenTotalSupply[epochId] = yTokenAmount;
      _yTokenUserBalances[epochId][address(this)] = yTokenAmount;
    }

    // initialize swap params
    uint256 S = _yTokenUserBalances[_currentEpochId][address(this)] + deltaYTokenAmount;
    (uint256 X, uint256 k0) = IVault(this).calcInitSwapParams(S);
    _epochNextSwapX[_currentEpochId] = X;
    _epochNextSwapK0[_currentEpochId] = k0;
  }

  function _updateStakingBribes() internal {
    IBribesPool stakingBribesPool = IBribesPool(_epochs[currentEpochId()].stakingBribesPool);
    // Keep bribes unclaimed, if nobody swapped for YT yet in this epoch
    if (stakingBribesPool.totalSupply() == 0) {
      return;
    }

    _doUpdateStakingBribes(stakingBribesPool);
  }

  function _balanceOfUnderlyingVault() internal view virtual returns (uint256);

  function _depositToUnderlyingVault(uint256 amount) internal virtual;

  function _settleRedeemPool(IRedeemPool redeemPool) internal virtual;

  function _doUpdateStakingBribes(IBribesPool stakingBribesPool) internal virtual;

  function _onVaultClose() internal virtual;

  function _redeemOnClose(uint256 ptAmount) internal virtual;


  /* ============== MODIFIERS =============== */

  modifier onlyOwnerOrBriber() {
    require(_msgSender() == owner() || isBriber(_msgSender()), "Not owner or briber");
    _;
  }

  modifier whenClosed() {
    require(_closed);
    _;
  }

  modifier whenNotClosed() {
    require(!_closed);
    _;
  }

  modifier noneZeroAmount(uint256 amount) {
    require(amount > 0, "Amount must be greater than 0");
    _;
  }

  modifier noneZeroAddress(address addr) {
    require(addr != address(0), "Zero address detected");
    _;
  }

  modifier validEpochId(uint256 epochId) {
    require(
      epochId > 0 && epochId <= _currentEpochId && _epochs[epochId].startTime > 0,
      "Invalid epoch id"
    );
    _;
  }

  /* =============== EVENTS ============= */

  event Closed();

  event EpochStarted(uint256 epochId, uint256 startTime, uint256 duration, address redeemPool, address stakingBribesPool, address adhocBribesPool);

  event PTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyMinted(uint256 indexed epochId, address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount);

  event Deposit(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 pTokenAmount, uint256 yTokenAmount);
  event Swap(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 fees, uint256 pTokenAmount, uint256 yTokenAmount);
  event Redeem(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
}
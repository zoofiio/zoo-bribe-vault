// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
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
import "../interfaces/IStakingPool.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";
import "../tokens/PToken.sol";
import "./BriberExtension.sol";

contract Vault is IVault, Pausable, ReentrancyGuard, ProtocolOwner, BriberExtension {
  using Counters for Counters.Counter;
  using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
  using EnumerableSet for EnumerableSet.AddressSet;
  using VaultCalculator for IVault;

  bool internal _closed;

  address public immutable settings;
  IStakingPool public stakingPool;
  IRedeemPoolFactory public redeemPoolFactory;
  IBribesPoolFactory public bribesPoolFactory;

  IERC20 internal immutable _assetToken;
  IPToken internal immutable _pToken;

  Counters.Counter internal _currentEpochId;  // default to 0
  DoubleEndedQueue.Bytes32Deque internal _allEpochIds;   // all Epoch Ids, start from 1
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
    address _stakingPool_,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) ProtocolOwner(_protocol) {
    require(
      _settings != address(0) && _redeemPoolFactory != address(0) && _bribesPoolFactory != address(0) && _stakingPool_ != address(0) && _assetToken_ != address(0),
      "Zero address detected"
    );
    require(_assetToken_ != Constants.NATIVE_TOKEN);
    require(IERC20Metadata(_assetToken_).decimals() <= 18);

    settings = _settings;
    redeemPoolFactory = IRedeemPoolFactory(_redeemPoolFactory);
    bribesPoolFactory = IBribesPoolFactory(_bribesPoolFactory);
    stakingPool = IStakingPool(_stakingPool_);

    _assetToken = IERC20(_assetToken_);
    // PToken's decimals should be the same as the asset token's decimals
    _pToken = new PToken(_protocol, _settings, _pTokenName, _pTokensymbol, IERC20Metadata(_assetToken_).decimals());
    
    _assetToken.approve(address(stakingPool), type(uint256).max);
  }

  /* ================= VIEWS ================ */

  function closed() external view returns (bool) {
    return _closed;
  }

  function assetBalance() public view override whenNotClosed returns (uint256) {
    return stakingPool.balanceOf(address(this));
  }

  function assetToken() public view override returns (address) {
    return address(_assetToken);
  }

  function pToken() public view override returns (address) {
    return address(_pToken);
  }

  function currentEpochId() public view returns (uint256) {
    require(_currentEpochId.current() > 0, "No epochs yet");
    return _currentEpochId.current();
  }

  function epochIdCount() public view returns (uint256) {
    return _allEpochIds.length();
  }

  function epochIdAt(uint256 index) public view returns (uint256) {
    return uint256(_allEpochIds.at(index));
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
    require(amount <= _assetToken.balanceOf(_msgSender()));

    bool newEpoch = _onUserAction(amount);

    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);
    stakingPool.stake(amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    uint256 pTokenSharesAmount = IPToken(_pToken).mint(_msgSender(), pTokenAmount);
    emit PTokenMinted(_msgSender(), amount, pTokenAmount, pTokenSharesAmount);

    uint256 yTokenAmount = amount;
    if (!newEpoch) {
      // update X and k0 on new deposit
      require(_epochNextSwapK0[_currentEpochId.current()] > 0);
      (uint256 X, uint256 k0) = IVault(this).updateSwapParamsOnDeposit(yTokenAmount);
      _epochNextSwapX[_currentEpochId.current()] = X;
      _epochNextSwapK0[_currentEpochId.current()] = k0;
    }

    // mint yToken to Vault
    _yTokenTotalSupply[_currentEpochId.current()] = _yTokenTotalSupply[_currentEpochId.current()] + yTokenAmount;
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)] + yTokenAmount;
    emit YTokenDummyMinted(_currentEpochId.current(), address(this), amount, yTokenAmount);

    emit Deposit(_currentEpochId.current(), _msgSender(), amount, pTokenAmount, yTokenAmount);
  }

  function redeem(uint256 amount) external nonReentrant whenClosed noneZeroAmount(amount) {
    require(amount <= IPToken(_pToken).balanceOf(_msgSender()));

    uint256 sharesAmount = IPToken(_pToken).burn(_msgSender(), amount);
    TokensTransfer.transferTokens(address(_assetToken), address(this), _msgSender(), amount);
    
    emit Redeem(_msgSender(), amount, sharesAmount);
  }

  function swap(uint256 amount) external nonReentrant whenNotPaused whenNotClosed noneZeroAmount(amount) {
    require(IERC20(_pToken).totalSupply() > 0, "No principal tokens");
    require(amount <= _assetToken.balanceOf(_msgSender()));

    _onUserAction(0);

    require(_currentEpochId.current() > 0);
    Constants.Epoch memory epoch = _epochs[_currentEpochId.current()];
    require(block.timestamp <= epoch.startTime + epoch.duration, "Epoch ended");

    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);

    uint256 fees = amount * paramValue("f2") / (10 ** IProtocolSettings(settings).decimals());
    if (fees > 0) {
      TokensTransfer.transferTokens(address(_assetToken), address(this), IProtocolSettings(settings).treasury(), fees);
    }
    uint256 netAmount = amount - fees;
    stakingPool.stake(netAmount);

    uint256 pTokenAmount = netAmount;
    IPToken(_pToken).rebase(pTokenAmount);

    _assetTotalSwapAmount[_currentEpochId.current()] = _assetTotalSwapAmount[_currentEpochId.current()] + netAmount;

    require(_epochNextSwapK0[_currentEpochId.current()] > 0);
    (uint256 X, uint256 m) = calcSwap(netAmount);
    _epochNextSwapX[_currentEpochId.current()] = X;

    uint256 yTokenAmount = m;
    require(_yTokenUserBalances[_currentEpochId.current()][address(this)] >= yTokenAmount, "Not enough yTokens");
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)] - yTokenAmount;
    
    IBribesPool autoBribesPool = IBribesPool(_epochs[_currentEpochId.current()].autoBribesPool);
    autoBribesPool.notifyYTSwappedForUser(_msgSender(), yTokenAmount);

    IBribesPool manualBribesPool = IBribesPool(_epochs[_currentEpochId.current()].manualBribesPool);
    manualBribesPool.notifyYTSwappedForUser(_msgSender(), yTokenAmount);

    emit Swap(_currentEpochId.current(), _msgSender(), amount, fees, pTokenAmount, yTokenAmount);
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

    if (_currentEpochId.current() > 0) {
      // force end current epoch
      Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
      if (block.timestamp < currentEpoch.startTime + currentEpoch.duration) {
        currentEpoch.duration = block.timestamp - currentEpoch.startTime;
      }
      _onEndEpoch(_currentEpochId.current());
      _updateAutoBribes();
    }

    // withdraw all assets from staking pool
    if (stakingPool.balanceOf(address(this)) > 0) {
      stakingPool.exit();
    }

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


  function addManualBribes(address bribeToken, uint256 amount) external nonReentrant onlyOwnerOrBriber noneZeroAddress(bribeToken) noneZeroAmount(amount) {
    // current epoch may be ended
    uint256 epochId = _currentEpochId.current();
    require(epochId > 0);

    IBribesPool manualBribesPool = IBribesPool(_epochs[_currentEpochId.current()].manualBribesPool);
    TokensTransfer.transferTokens(bribeToken, _msgSender(), address(this), amount);

    IERC20(bribeToken).approve(address(manualBribesPool), amount);
    manualBribesPool.addBribes(bribeToken, amount);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _onUserAction(uint256 deltaYTokenAmount) internal returns (bool) {
    bool newEpoch = false;
    // Start first epoch
    if (_currentEpochId.current() == 0) {
      _startNewEpoch(deltaYTokenAmount);
      newEpoch = true;
    }
    else {
      Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
      if (block.timestamp > currentEpoch.startTime + currentEpoch.duration) {
        _onEndEpoch(_currentEpochId.current());
        _startNewEpoch(deltaYTokenAmount);
        newEpoch = true;
      }
    }
    _updateAutoBribes();

    return newEpoch;
  }

  function _onEndEpoch(uint256 epochId) internal {
    Constants.Epoch memory epoch = _epochs[epochId];

    IRedeemPool redeemPool = IRedeemPool(epoch.redeemPool);

    uint256 amount = redeemPool.totalRedeemingBalance();
    if (amount > 0) {
      IPToken(_pToken).burn(address(redeemPool), amount);
      stakingPool.withdraw(amount);
      TokensTransfer.transferTokens(address(_assetToken), address(this), address(redeemPool), amount);
    }

    redeemPool.notifySettlement(amount);
  }

  function _startNewEpoch(uint256 deltaYTokenAmount) internal {
    uint256 oldEpochId = _currentEpochId.current();

    _currentEpochId.increment();
    uint256 epochId = _currentEpochId.current();
    _allEpochIds.pushBack(bytes32(epochId));

    _epochs[epochId].epochId = epochId;
    _epochs[epochId].startTime = block.timestamp;
    _epochs[epochId].duration = paramValue("D");
    _epochs[epochId].redeemPool = redeemPoolFactory.createRedeemPool(address(this));
    _epochs[epochId].autoBribesPool = bribesPoolFactory.createAutoBribesPool(address(this));
    _epochs[epochId].manualBribesPool = bribesPoolFactory.createManualBribesPool(address(this));

    emit EpochStarted(epochId, block.timestamp, paramValue("D"), _epochs[epochId].redeemPool, _epochs[epochId].autoBribesPool, _epochs[epochId].manualBribesPool);

    if (oldEpochId > 0) {
      uint256 yTokenAmount = IERC20(_pToken).totalSupply();
      _yTokenTotalSupply[epochId] = yTokenAmount;
      _yTokenUserBalances[epochId][address(this)] = yTokenAmount;
    }

    // initialize swap params
    uint256 S = _yTokenUserBalances[_currentEpochId.current()][address(this)] + deltaYTokenAmount;
    (uint256 X, uint256 k0) = IVault(this).calcInitSwapParams(S);
    _epochNextSwapX[_currentEpochId.current()] = X;
    _epochNextSwapK0[_currentEpochId.current()] = k0;
  }

  function _updateAutoBribes() internal {
    uint256 epochId = _currentEpochId.current();

    IBribesPool autoBribesPool = IBribesPool(_epochs[epochId].autoBribesPool);
    // Keep bribes unclaimed, if nobody swapped for YT yet in this epoch
    if (autoBribesPool.totalSupply() == 0) {
      return;
    }

    uint256 rewardTokensCount = 0;
    while(true) {
      try stakingPool.rewardTokens(rewardTokensCount) returns (address) {
        rewardTokensCount++;
      } catch {
        break;
      }
    }

    address[] memory rewardTokens = new address[](rewardTokensCount);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      rewardTokens[i] = stakingPool.rewardTokens(i);
    }

    stakingPool.getReward();

    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      uint256 allBribes = IERC20(bribeToken).balanceOf(address(this));

      // Add bribes to auto bribes pool
      if (allBribes > 0) {
        IERC20(bribeToken).approve(address(autoBribesPool), allBribes);
        autoBribesPool.addBribes(bribeToken, allBribes);
      }
    }
  }

  /* ============== MODIFIERS =============== */

  modifier onlyOwnerOrBriber() {
    require(_msgSender() == owner() || isBriber(_msgSender()));
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
      epochId > 0 && epochId <= _currentEpochId.current() && _epochs[epochId].startTime > 0,
      "Invalid epoch id"
    );
    _;
  }

  /* =============== EVENTS ============= */

  event Closed();

  event EpochStarted(uint256 epochId, uint256 startTime, uint256 duration, address redeemPool, address autoBribesPool, address manualBribesPool);

  event PTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyMinted(uint256 indexed epochId, address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount);

  event Deposit(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 pTokenAmount, uint256 yTokenAmount);
  event Swap(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 fees, uint256 pTokenAmount, uint256 yTokenAmount);
  event Redeem(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
}
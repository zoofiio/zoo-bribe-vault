// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../libs/VaultCalculator.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IPToken.sol";
import "../interfaces/IStakingPool.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";
import "../tokens/PToken.sol";
import "./RedeemPool.sol";
import "./BriberExtension.sol";

contract Vault is IVault, ReentrancyGuard, ProtocolOwner, BriberExtension {
  using Counters for Counters.Counter;
  using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeMath for uint256;
  using VaultCalculator for IVault;

  bool internal _depositPaused;
  bool internal _swapPaused;
  bool internal _claimBribesPaused;

  bool internal _closed;

  address public immutable settings;
  IStakingPool public stakingPool;

  IERC20 internal immutable _assetToken;
  IPToken internal immutable _pToken;

  Counters.Counter internal _currentEpochId;  // default to 0
  DoubleEndedQueue.Bytes32Deque internal _allEpochIds;   // all Epoch Ids, start from 1
  mapping(uint256 => Constants.Epoch) internal _epochs;  // epoch id => epoch info

  mapping(uint256 => uint256) internal _assetTotalSwapAmount;

  mapping(uint256 => uint256) internal _yTokenTotalSupply;  // including yTokens hold by Vault
  mapping(uint256 => mapping(address => uint256)) internal _yTokenUserBalances;
  mapping(uint256 => uint256) internal _yTokenTotalSupplySynthetic;  // NOT including yTokens hold by Vault
  mapping(uint256 => mapping(address => uint256)) internal _yTokenUserBalancesSynthetic;

  mapping(uint256 => uint256) internal _epochNextSwapX;
  mapping(uint256 => uint256) internal _epochNextSwapK0;

  mapping(uint256 => EnumerableSet.AddressSet) internal _bribeTokens;  // epoch id => bribe tokens set
  mapping(uint256 => mapping(address => uint256)) internal _bribeTotalAmount;  // epoch id => (bribe token => total amount)

  constructor(
    address _protocol,
    address _settings,
    address _stakingPool_,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) ProtocolOwner(_protocol) {
    require(
      _settings != address(0) && _stakingPool_ != address(0) && _assetToken_ != address(0),
      "Zero address detected"
    );
    require(_assetToken_ != Constants.NATIVE_TOKEN, "Asset token cannot be NATIVE_TOKEN");

    settings = _settings;
    stakingPool = IStakingPool(_stakingPool_);

    _assetToken = IERC20(_assetToken_);
    // PToken's decimals should be the same as the asset token's decimals
    _pToken = new PToken(_protocol, _settings, _pTokenName, _pTokensymbol, IERC20Metadata(_assetToken_).decimals());
    
    _assetToken.approve(address(stakingPool), type(uint256).max);
  }

  /* ================= VIEWS ================ */

  function paused() external view virtual returns (bool, bool, bool) {
    return (_depositPaused, _swapPaused, _claimBribesPaused);
  }

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

  function yTokenTotalSupplySynthetic(uint256 epochId) public view validEpochId(epochId) returns (uint256) {
    return _yTokenTotalSupplySynthetic[epochId];
  }

  function yTokenUserBalanceSynthetic(uint256 epochId, address user) public view validEpochId(epochId) returns (uint256) {
    require(user != address(this));
    return _yTokenUserBalancesSynthetic[epochId][user];
  }

  function calcBribes(uint256 epochId, address account) public view validEpochId(epochId) returns (Constants.BribeInfo[] memory) {
    return IVault(this).doCalcBribes(epochId, account);
  }

  function bribeTokens(uint256 epochId) public view validEpochId(epochId) returns (address[] memory) {
    return _bribeTokens[epochId].values();
  }

  function bribeTotalAmount(uint256 epochId, address bribeToken) public view validEpochId(epochId) returns (uint256) {
    return _bribeTotalAmount[epochId][bribeToken];
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

  function deposit(uint256 amount) external nonReentrant whenDepositNotPaused whenNotClosed noneZeroAmount(amount) onUserAction {
    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);
    stakingPool.stake(amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    uint256 pTokenSharesAmount = IPToken(_pToken).mint(_msgSender(), pTokenAmount);
    emit PTokenMinted(_msgSender(), amount, pTokenAmount, pTokenSharesAmount);

    uint256 yTokenAmount = amount;

    // calculate initial X and k0 on epoch start
    if (_epochNextSwapK0[_currentEpochId.current()] == 0) {
      uint256 S = _yTokenUserBalances[_currentEpochId.current()][address(this)];
      // for epochs with no yToken carried from previous epoch, we are doing first deposit
      if (S == 0) {
        S = yTokenAmount;
      }
      (uint256 X, uint256 k0) = IVault(this).calcInitSwapParams(S);
      _epochNextSwapX[_currentEpochId.current()] = X;
      _epochNextSwapK0[_currentEpochId.current()] = k0;
    }
    // update X and k0 on new deposit
    else {
      (uint256 X, uint256 k0) = IVault(this).updateSwapParamsOnDeposit(yTokenAmount);
      _epochNextSwapX[_currentEpochId.current()] = X;
      _epochNextSwapK0[_currentEpochId.current()] = k0;
    }

    // mint yToken to Vault
    _yTokenTotalSupply[_currentEpochId.current()] = _yTokenTotalSupply[_currentEpochId.current()].add(yTokenAmount);
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)].add(yTokenAmount);
    emit YTokenDummyMinted(_currentEpochId.current(), address(this), amount, yTokenAmount);

    emit Deposit(_currentEpochId.current(), _msgSender(), amount, pTokenAmount, yTokenAmount);
  }

  function redeem(uint256 amount) external nonReentrant whenClosed noneZeroAmount(amount) {
    require(amount <= IPToken(_pToken).balanceOf(_msgSender()));

    uint256 sharesAmount = IPToken(_pToken).burn(_msgSender(), amount);
    TokensTransfer.transferTokens(address(_assetToken), address(this), _msgSender(), amount);
    
    emit Redeem(_msgSender(), amount, sharesAmount);
  }

  function swap(uint256 amount) external nonReentrant whenSwapNotPaused whenNotClosed noneZeroAmount(amount) onUserAction {
    require(IERC20(_pToken).totalSupply() > 0, "No principal tokens");

    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);

    uint256 fees = amount.mul(paramValue("f2")).div(10 ** IProtocolSettings(settings).decimals());
    if (fees > 0) {
      TokensTransfer.transferTokens(address(_assetToken), address(this), IProtocolSettings(settings).treasury(), fees);
    }
    uint256 netAmount = amount.sub(fees);
    stakingPool.stake(netAmount);

    uint256 pTokenAmount = netAmount;
    IPToken(_pToken).rebase(pTokenAmount);

    _assetTotalSwapAmount[_currentEpochId.current()] = _assetTotalSwapAmount[_currentEpochId.current()].add(netAmount);

    (uint256 X, uint256 m) = calcSwap(netAmount);
    _epochNextSwapX[_currentEpochId.current()] = X;

    uint256 yTokenAmount = m;
    require(_yTokenUserBalances[_currentEpochId.current()][address(this)] >= yTokenAmount, "Not enough yTokens");
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)].sub(yTokenAmount);
    _yTokenUserBalances[_currentEpochId.current()][_msgSender()] = _yTokenUserBalances[_currentEpochId.current()][_msgSender()].add(yTokenAmount);

    Constants.Epoch memory epoch = _epochs[_currentEpochId.current()];
    uint256 yTokenAmountSynthetic = yTokenAmount.mul(epoch.startTime.add(epoch.duration).sub(block.timestamp));
    _yTokenUserBalancesSynthetic[_currentEpochId.current()][_msgSender()] = _yTokenUserBalancesSynthetic[_currentEpochId.current()][_msgSender()].add(yTokenAmountSynthetic);
    _yTokenTotalSupplySynthetic[_currentEpochId.current()] = _yTokenTotalSupplySynthetic[_currentEpochId.current()].add(yTokenAmountSynthetic);

    emit Swap(_currentEpochId.current(), _msgSender(), amount, fees, pTokenAmount, yTokenAmount);
  }

  function claimBribes(uint256 epochId) external nonReentrant whenClaimBribesNotPaused validEpochId(epochId) {
    Constants.Epoch memory epoch = epochInfoById(epochId);
    uint256 epochEndTime = epoch.startTime.add(epoch.duration);
    require(block.timestamp > epochEndTime, "Epoch not ended yet");

    uint256 yTokenBalanceSynthetic = _yTokenUserBalancesSynthetic[epochId][_msgSender()];
    require(yTokenBalanceSynthetic > 0, "No yToken balance");
    uint256 yTokenTotalSynthetic = _yTokenTotalSupplySynthetic[epochId];
    require(yTokenTotalSynthetic >= yTokenBalanceSynthetic, "Invalid yToken balance");

    Constants.BribeInfo[] memory bribeInfo = calcBribes(epochId, _msgSender());
    for (uint256 i = 0; i < bribeInfo.length; i++) {
      Constants.BribeInfo memory info = bribeInfo[i];
      if (info.bribeAmount > 0) {
        _bribeTotalAmount[info.epochId][info.bribeToken] = _bribeTotalAmount[info.epochId][info.bribeToken].sub(info.bribeAmount);
        TokensTransfer.transferTokens(info.bribeToken, address(this), _msgSender(), info.bribeAmount);
        emit BribesClaimed(info.bribeToken, _msgSender(), info.bribeAmount);
      }
    }

    _yTokenUserBalancesSynthetic[epochId][_msgSender()] = 0;
    _yTokenTotalSupplySynthetic[epochId] = yTokenTotalSynthetic.sub(yTokenBalanceSynthetic);
    emit YTokenDummyBurned(epochId, _msgSender(), yTokenBalanceSynthetic);
  }

  function batchClaimRedeemAssets(uint256[] memory epochIds) external nonReentrant {
    for (uint256 i = 0; i < epochIds.length; i++) {
      Constants.Epoch memory epoch = _epochs[epochIds[i]];
      RedeemPool redeemPool = RedeemPool(epoch.redeemPool);
      redeemPool.claimAssetTokenFor(_msgSender());
    }
  }
  
  /* ========== RESTRICTED FUNCTIONS ========== */

  function close() external nonReentrant whenNotClosed onlyOwner {
    _closed = true;

    if (_currentEpochId.current() > 0) {
      // force end current epoch
      Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
      if (block.timestamp < currentEpoch.startTime.add(currentEpoch.duration)) {
        currentEpoch.duration = block.timestamp.sub(currentEpoch.startTime);
      }
      _onEndEpoch(_currentEpochId.current());
      _updateBribes();
    }

    // withdraw all assets from staking pool
    if (stakingPool.balanceOf(address(this)) > 0) {
      stakingPool.exit();
    }

    emit VaultClosed();
  }

  function pauseDeposit() external nonReentrant onlyOwner {
    _depositPaused = true;
    emit DepositPaused();
  }

  function unpauseDeposit() external nonReentrant onlyOwner {
    _depositPaused = false;
    emit DepositUnpaused();
  }

  function pauseSwap() external nonReentrant onlyOwner {
    _swapPaused = true;
    emit SwapPaused();
  }

  function unpauseSwap() external nonReentrant onlyOwner {
    _swapPaused = false;
    emit SwapUnpaused();
  }

  function pauseClaimBribes() external nonReentrant onlyOwner {
    _claimBribesPaused = true;
    emit ClaimBribesPaused();
  }

  function unpauseClaimBribes() external nonReentrant onlyOwner {
    _claimBribesPaused = false;
    emit ClaimBribesUnpaused();
  }

  function setBriber(address account, bool briber) external nonReentrant onlyOwner {
    _setBriber(account, briber);
  }

  function addBribeToken(address bribeToken) external nonReentrant onlyOwnerOrBriber noneZeroAddress(bribeToken) {
    // current epoch may be ended
    uint256 epochId = _currentEpochId.current();
    require(epochId > 0);
    EnumerableSet.AddressSet storage epochBribeTokens = _bribeTokens[epochId];
    bool added = epochBribeTokens.add(bribeToken);
    if (added) {
      emit BribeTokenAdded(epochId, bribeToken, _msgSender());
    }
  }

  function addBribes(address bribeToken, uint256 amount) external nonReentrant onlyOwnerOrBriber noneZeroAddress(bribeToken) noneZeroAmount(amount) {
    // current epoch may be ended
    uint256 epochId = _currentEpochId.current();
    require(epochId > 0);
    require(_bribeTokens[epochId].contains(bribeToken));

    TokensTransfer.transferTokens(bribeToken, _msgSender(), address(this), amount);
    _bribeTotalAmount[epochId][bribeToken] = _bribeTotalAmount[epochId][bribeToken].add(amount);
    emit BribesAdded(epochId, bribeToken, amount, _msgSender());
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _onEndEpoch(uint256 epochId) internal {
    // console.log("_onEndEpoch, end epoch %s", epochId);
    Constants.Epoch memory epoch = _epochs[epochId];

    RedeemPool redeemPool = RedeemPool(epoch.redeemPool);

    uint256 amount = redeemPool.totalRedeemingBalance();
    if (amount > 0) {
      IPToken(_pToken).burn(address(redeemPool), amount);
      stakingPool.withdraw(amount);
      TokensTransfer.transferTokens(address(_assetToken), address(this), address(redeemPool), amount);
    }

    redeemPool.notifySettlement(amount);
  }

  function _startNewEpoch() internal {
    uint256 oldEpochId = _currentEpochId.current();

    _currentEpochId.increment();
    uint256 epochId = _currentEpochId.current();
    _allEpochIds.pushBack(bytes32(epochId));

    _epochs[epochId].epochId = epochId;
    _epochs[epochId].startTime = block.timestamp;
    _epochs[epochId].duration = paramValue("D");
    _epochs[epochId].redeemPool = address(new RedeemPool(address(this)));

    emit EpochStarted(epochId, block.timestamp, paramValue("D"), _epochs[epochId].redeemPool);

    if (oldEpochId > 0) {
      uint256 yTokenAmount = IERC20(_pToken).totalSupply();
      _yTokenTotalSupply[epochId] = yTokenAmount;
      _yTokenUserBalances[epochId][address(this)] = yTokenAmount;
    }
  }

  function _updateBribes() internal {
    uint256 epochId = _currentEpochId.current();
    EnumerableSet.AddressSet storage epochBribeTokens = _bribeTokens[epochId];

    uint256 rewardTokensCount = 0;
    while(true) {
      try stakingPool.rewardTokens(rewardTokensCount) returns (address) {
        rewardTokensCount++;
      } catch {
        break;
      }
    }
    // console.log("StakingPool reward tokens count: %s", rewardTokensCount);

    address[] memory rewardTokens = new address[](rewardTokensCount);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      rewardTokens[i] = stakingPool.rewardTokens(i);
    }

    uint256[] memory previousBribeTokenBalance = new uint256[](rewardTokens.length);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      bool added = epochBribeTokens.add(bribeToken);
      if (added) {
        emit BribeTokenAdded(epochId, bribeToken, address(stakingPool));
      }
      previousBribeTokenBalance[i] = IERC20(bribeToken).balanceOf(address(this));
    }

    stakingPool.getReward();

    mapping(address => uint256) storage epochBribeTotalAmount = _bribeTotalAmount[epochId];
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      uint256 newBribeTokenBalance = IERC20(bribeToken).balanceOf(address(this));
      uint256 bribesAdded = newBribeTokenBalance.sub(previousBribeTokenBalance[i]);
      epochBribeTotalAmount[bribeToken] = epochBribeTotalAmount[bribeToken].add(bribesAdded);
      emit BribesAdded(epochId, bribeToken, bribesAdded, address(stakingPool));
      // console.log("epoch: %s, bribeToken: %s, total bribe amount: %s", epochId, bribeToken, epochBribeTotalAmount[bribeToken]);
    }
  }

  /* ============== MODIFIERS =============== */

  modifier onlyOwnerOrBriber() {
    require(_msgSender() == owner() || isBriber(_msgSender()));
    _;
  }

  modifier whenDepositNotPaused() {
    require(!_depositPaused, "Deposits are paused");
    _;
  }

  modifier whenSwapNotPaused() {
    require(!_swapPaused, "Swaps are paused");
    _;
  }

  modifier whenClaimBribesNotPaused() {
    require(!_claimBribesPaused, "Claim bribes are paused");
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
    // console.log("validEpochId, epochId: %s, currentEpochId: %s, _epochs[epochId].startTime: %s", epochId, _currentEpochId.current(), _epochs[epochId].startTime);
    require(
      epochId > 0 && epochId <= _currentEpochId.current() && _epochs[epochId].startTime > 0,
      "Invalid epoch id"
    );
    _;
  }

  modifier onUserAction() {
    // Start first epoch
    if (_currentEpochId.current() == 0) {
      _startNewEpoch();
    }
    else {
      Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
      if (block.timestamp > currentEpoch.startTime.add(currentEpoch.duration)) {
        _onEndEpoch(_currentEpochId.current());
        _startNewEpoch();
      }
    }
    _updateBribes();

    _;
  }

  /* =============== EVENTS ============= */

  event VaultClosed();
  event DepositPaused();
  event DepositUnpaused();
  event SwapPaused();
  event SwapUnpaused();
  event ClaimBribesPaused();
  event ClaimBribesUnpaused();

  event EpochStarted(uint256 epochId, uint256 startTime, uint256 duration, address redeemPool);

  event PTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyMinted(uint256 indexed epochId, address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount);
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyBurned(uint256 indexed epochId, address indexed user, uint256 yTokenAmount);

  event Deposit(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 pTokenAmount, uint256 yTokenAmount);
  event Swap(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 fees, uint256 pTokenAmount, uint256 yTokenAmount);
  event BribesClaimed(address indexed bribeToken, address indexed user, uint256 amount);
  event Redeem(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);

  event BribeTokenAdded(uint256 indexed epochId, address indexed bribeToken, address source);
  event BribesAdded(uint256 indexed epochId, address indexed bribeToken, uint256 amount, address source);
}
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

contract Vault is IVault, ReentrancyGuard, ProtocolOwner {
  using Counters for Counters.Counter;
  using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeMath for uint256;
  using VaultCalculator for IVault;

  bool internal _depositPaused;
  bool internal _swapPaused;
  bool internal _claimBribesPaused;

  address public immutable settings;
  IStakingPool public stakingPool;

  IERC20 internal immutable _assetToken;
  IPToken internal immutable _pToken;

  Counters.Counter internal _currentEpochId;  // default to 0
  DoubleEndedQueue.Bytes32Deque internal _allEpochIds;   // all Epoch Ids, start from 1
  mapping(uint256 => Constants.Epoch) internal _epochs;  // epoch id => epoch info

  mapping(uint256 => uint256) _yTokenTotalSupply;
  mapping(uint256 => mapping(address => uint256)) _yTokenUserBalances;
  mapping(uint256 => uint256) _yTokenTotalSupplySynthetic;
  mapping(uint256 => mapping(address => uint256)) _yTokenUserBalancesSynthetic;

  mapping(uint256 => uint256) _epochLastSwapTimestampF0;
  mapping(uint256 => uint256) _epochLastSwapPriceF0;  // P(S,t)

  // mapping(uint256 => uint256) _epochLastSwapTimestampF1;
  mapping(uint256 => uint256) _epochNextSwapK0;

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

    _depositPaused = false;
    _swapPaused = false;
    _claimBribesPaused = false;
  }

  /* ================= VIEWS ================ */

  function paused() external view virtual returns (bool, bool, bool) {
    return (_depositPaused, _swapPaused, _claimBribesPaused);
  }

  function assetBalance() public view override returns (uint256) {
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
    return _yTokenUserBalancesSynthetic[epochId][user];
  }

  function calcBribes(uint256 epochId, address account) public view validEpochId(epochId) returns (Constants.BribeInfo[] memory) {
    return IVault(this).doCalcBribes(epochId, account);
  }

  function bribeTokens(uint256 epochId) public view validEpochId(epochId) returns (address[] memory) {
    EnumerableSet.AddressSet storage epochBribeTokens = _bribeTokens[epochId];
    address[] memory tokens = new address[](epochBribeTokens.length());
    for (uint256 i = 0; i < epochBribeTokens.length(); i++) {
      tokens[i] = epochBribeTokens.at(i);
    }
    return tokens;
  }

  function bribeTotalAmount(uint256 epochId, address bribeToken) public view validEpochId(epochId) returns (uint256) {
    return _bribeTotalAmount[epochId][bribeToken];
  }

  function paramValue(bytes32 param) public view override returns (uint256) {
    return IProtocolSettings(settings).vaultParamValue(address(this), param);
  }

  function epochLastSwapTimestampF0(uint256 epochId) public view returns (uint256) {
    return _epochLastSwapTimestampF0[epochId];
  }

  function epochLastSwapPriceScaledF0(uint256 epochId) public view returns (uint256) {
    return _epochLastSwapPriceF0[epochId];
  }

  function epochNextSwapK0(uint256 epochId) public view returns (uint256) {
    return _epochNextSwapK0[epochId];
  }

  function calcSwapResultF0(uint256 assetAmount) public view returns (Constants.SwapResultF0 memory) {
    return IVault(this).doCalcSwapF0(assetAmount);
  }

  function calcSwapResult(uint256 assetAmount) public view returns (uint256) {
    return IVault(this).doCalcSwap(assetAmount);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function deposit(uint256 amount) external nonReentrant whenDepositNotPaused noneZeroAmount(amount) onUserAction {
    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);
    stakingPool.stake(amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    uint256 pTokenSharesAmount = IPToken(_pToken).mint(_msgSender(), pTokenAmount);
    emit PTokenMinted(_msgSender(), amount, pTokenAmount, pTokenSharesAmount);

    // update k0
    uint256 yTokenAmount = amount;

    // calculate initial k0 on epoch start
    if (_epochNextSwapK0[_currentEpochId.current()] == 0) {
      uint256 S = _yTokenUserBalances[_currentEpochId.current()][address(this)];
      // for epochs with no yToken carried from previous epoch, we are doing first deposit
      if (S == 0) {
        S = yTokenAmount;
      }
      _epochNextSwapK0[_currentEpochId.current()] = IVault(this).calcNextSwapK0(S);
    }
    // update k0 on new deposit
    else {
      _epochNextSwapK0[_currentEpochId.current()] = IVault(this).updateNextSwapK0(yTokenAmount);
    }

    // mint yToken to Vault
    Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
    uint256 currentEpochEndTime = currentEpoch.startTime.add(currentEpoch.duration);
    require(block.timestamp <= currentEpochEndTime, "Current epoch has ended");

    _yTokenTotalSupply[_currentEpochId.current()] = _yTokenTotalSupply[_currentEpochId.current()].add(yTokenAmount);
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)].add(yTokenAmount);
    emit YTokenDummyMinted(_currentEpochId.current(), address(this), amount, yTokenAmount);

    uint256 yTokenAmountSynthetic = yTokenAmount.mul(currentEpochEndTime.sub(block.timestamp));
    _yTokenTotalSupplySynthetic[_currentEpochId.current()] = _yTokenTotalSupplySynthetic[_currentEpochId.current()].add(yTokenAmountSynthetic);
    _yTokenUserBalancesSynthetic[_currentEpochId.current()][address(this)] = _yTokenUserBalancesSynthetic[_currentEpochId.current()][address(this)].add(yTokenAmountSynthetic);


    emit Deposit(_currentEpochId.current(), _msgSender(), amount, pTokenAmount, yTokenAmount);
  }

  function swap(uint256 amount) external nonReentrant whenSwapNotPaused noneZeroAmount(amount) onUserAction {
    require(IERC20(_pToken).totalSupply() > 0, "No principal token minted yet");

    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);

    uint256 fees = amount.mul(paramValue("f2")).div(10 ** IProtocolSettings(settings).decimals());
    if (fees > 0) {
      TokensTransfer.transferTokens(address(_assetToken), address(this), IProtocolSettings(settings).treasury(), fees);
    }
    uint256 netAmount = amount.sub(fees);
    uint256 pTokenAmount = netAmount;
    stakingPool.stake(pTokenAmount);
    IPToken(_pToken).rebase(pTokenAmount);

    uint256 yTokenAmount = 0;
    uint256 swapFormula = paramValue("SwapF");
    if (swapFormula == 0) {
      Constants.SwapResultF0 memory args = calcSwapResultF0(netAmount);
      yTokenAmount = args.Y;
      _epochLastSwapTimestampF0[_currentEpochId.current()] = block.timestamp;

      bool useFloorPrice = (!args.P_scaled_positive) || (args.P_scaled < args.P_floor_scaled);
      _epochLastSwapPriceF0[_currentEpochId.current()] = useFloorPrice ? args.P_floor_scaled : args.P_scaled;
    }
    else {
      yTokenAmount = calcSwapResult(netAmount);
    }

    require(_yTokenUserBalances[_currentEpochId.current()][address(this)] >= yTokenAmount, "Not enough yToken balance");
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)].sub(yTokenAmount);
    _yTokenUserBalances[_currentEpochId.current()][_msgSender()] = _yTokenUserBalances[_currentEpochId.current()][_msgSender()].add(yTokenAmount);

    Constants.Epoch memory epoch = _epochs[_currentEpochId.current()];
    uint256 yTokenAmountSynthetic = yTokenAmount.mul(epoch.startTime.add(epoch.duration).sub(block.timestamp));
    _yTokenUserBalancesSynthetic[_currentEpochId.current()][address(this)] = _yTokenUserBalancesSynthetic[_currentEpochId.current()][address(this)].sub(yTokenAmountSynthetic);
    _yTokenUserBalancesSynthetic[_currentEpochId.current()][_msgSender()] = _yTokenUserBalancesSynthetic[_currentEpochId.current()][_msgSender()].add(yTokenAmountSynthetic);

    emit Swap(_currentEpochId.current(), _msgSender(), amount, fees, pTokenAmount, yTokenAmount);
  }

  function claimBribes(uint256 epochId) external nonReentrant whenClaimBribesNotPaused validEpochId(epochId) {
    uint256 yTokenBalanceSynthetic = _yTokenUserBalancesSynthetic[epochId][_msgSender()];
    require(yTokenBalanceSynthetic > 0, "No yToken balance");
    uint256 yTokenTotalSynthetic = _yTokenTotalSupplySynthetic[epochId];
    require(yTokenTotalSynthetic >= yTokenBalanceSynthetic, "Invalid yToken balance");

    _yTokenUserBalancesSynthetic[epochId][_msgSender()] = 0;
    _yTokenTotalSupplySynthetic[epochId] = yTokenTotalSynthetic.sub(yTokenBalanceSynthetic);
    emit YTokenDummyBurned(epochId, _msgSender(), yTokenBalanceSynthetic);

    Constants.BribeInfo[] memory bribeInfo = calcBribes(epochId, _msgSender());
    for (uint256 i = 0; i < bribeInfo.length; i++) {
      Constants.BribeInfo memory info = bribeInfo[i];
      if (info.bribeAmount > 0) {
        _bribeTotalAmount[info.epochId][info.bribeToken] = _bribeTotalAmount[info.epochId][info.bribeToken].sub(info.bribeAmount);
        TokensTransfer.transferTokens(info.bribeToken, address(this), _msgSender(), info.bribeAmount);
        emit BribesClaimed(info.bribeToken, _msgSender(), info.bribeAmount);
      }
    }
  }
  
  /* ========== RESTRICTED FUNCTIONS ========== */

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

  // function updateStakingPool(address _stakingPool) external nonReentrant onlyOwner {
  //   stakingPool = IStakingPool(_stakingPool);
  // }

  // function rescueFromStakingPool(uint256 amount, address recipient) external nonReentrant onlyOwner {
  //   stakingPool.withdraw(amount);
  //   TokensTransfer.transferTokens(address(_assetToken), address(this), recipient, amount);
  // }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _onEndEpoch(uint256 epochId) internal {
    console.log("_onEndEpoch, end epoch %s", epochId);
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

    // Y tokens virtually hold by the Vault, need move to new epoch
    if (oldEpochId  > 0) {
      _yTokenTotalSupply[epochId] = _yTokenUserBalances[oldEpochId][address(this)];
      _yTokenUserBalances[epochId][address(this)] = _yTokenUserBalances[oldEpochId][address(this)];

      _yTokenTotalSupplySynthetic[epochId] = _yTokenUserBalancesSynthetic[oldEpochId][address(this)];
      _yTokenUserBalancesSynthetic[epochId][address(this)] = _yTokenUserBalancesSynthetic[oldEpochId][address(this)];
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
    console.log("StakingPool reward tokens count: %s", rewardTokensCount);

    address[] memory rewardTokens = new address[](rewardTokensCount);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      rewardTokens[i] = stakingPool.rewardTokens(i);
    }

    uint256[] memory previousBribeTokenBalance = new uint256[](rewardTokens.length);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      bool added = epochBribeTokens.add(bribeToken);
      if (added) {
        emit BribeTokenAdded(epochId, bribeToken);
      }
      previousBribeTokenBalance[i] = IERC20(bribeToken).balanceOf(address(this));
    }

    stakingPool.getReward();

    mapping(address => uint256) storage epochBribeTotalAmount = _bribeTotalAmount[epochId];
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      uint256 newBribeTokenBalance = IERC20(bribeToken).balanceOf(address(this));
      epochBribeTotalAmount[bribeToken] = epochBribeTotalAmount[bribeToken].add(newBribeTokenBalance.sub(previousBribeTokenBalance[i]));
      
      console.log("epoch: %s, bribeToken: %s, total bribe amount: %s", epochId, bribeToken, epochBribeTotalAmount[bribeToken]);
    }
  }

  /* ============== MODIFIERS =============== */

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

  event DepositPaused();
  event DepositUnpaused();
  event SwapPaused();
  event SwapUnpaused();
  event ClaimBribesPaused();
  event ClaimBribesUnpaused();

  event PTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyMinted(uint256 indexed epochId, address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount);
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyBurned(uint256 indexed epochId, address indexed user, uint256 yTokenAmount);

  event Deposit(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 pTokenAmount, uint256 yTokenAmount);
  event Swap(uint256 indexed epochId, address indexed user, uint256 assetAmount, uint256 fees, uint256 pTokenAmount, uint256 yTokenAmount);
  event BribesClaimed(address indexed bribeToken, address indexed user, uint256 amount);

  event BribeTokenAdded(uint256 indexed epochId, address indexed bribeToken);

}
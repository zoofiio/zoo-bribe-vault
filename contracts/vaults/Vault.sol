// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IPToken.sol";
import "../interfaces/IStakingPool.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";
import "./RedeemPool.sol";

contract Vault is IVault, ReentrancyGuard, ProtocolOwner {
  using Counters for Counters.Counter;
  using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
  using SafeMath for uint256;
  using Strings for uint256;

  IProtocolSettings public immutable settings;
  IStakingPool public immutable stakingPool;

  IERC20 internal immutable _assetToken;
  IPToken internal immutable _pToken;

  Counters.Counter internal _currentEpochId;  // default to 0
  DoubleEndedQueue.Bytes32Deque internal _allEpochIds;   // all Epoch Ids, start from 1
  mapping(uint256 => Constants.Epoch) internal _epochs;  // epoch id => epoch info

  mapping(uint256 => uint256) _yTokenTotalSupply;
  mapping(uint256 => mapping(address => uint256)) _yTokenUserBalances;

  constructor(
    address _protocol,
    address _settings,
    address _stakingPool_,
    address _assetToken_,
    address _pToken_
  ) ProtocolOwner(_protocol) {
    require(
      _settings != address(0) && _stakingPool_ != address(0) && _assetToken_ != address(0) && _pToken_ != address(0),
      "Zero address detected"
    );
    require(_assetToken_ != Constants.NATIVE_TOKEN, "Asset token cannot be NATIVE_TOKEN");

    settings = IProtocolSettings(_settings);
    stakingPool = IStakingPool(_stakingPool_);

    _assetToken = IERC20(_assetToken_);
    _pToken = IPToken(_pToken_);
    
    _assetToken.approve(address(stakingPool), type(uint256).max);
  }

  /* ================= VIEWS ================ */

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
    return _currentEpochId.current();
  }

  function epochIdCount() public view returns (uint256) {
    return _allEpochIds.length();
  }

  function epochIdAt(uint256 index) public view returns (uint256) {
    return uint256(_allEpochIds.at(index));
  }

  function epochInfoById(uint256 epochId) public view returns (Constants.Epoch memory) {
    return _epochs[epochId];
  }

  function yTokenTotalSupply(uint256 epochId) public view validEpochId(epochId) returns (uint256) {
    return _yTokenTotalSupply[epochId];
  }

  function yTokenUserBalance(uint256 epochId, address user) public view validEpochId(epochId) returns (uint256) {
    return _yTokenUserBalances[epochId][user];
  }

  function paramValue(bytes32 param) public view override returns (uint256) {
    return settings.vaultParamValue(address(this), param);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function depoit(uint256 amount) external payable nonReentrant noneZeroAmount(amount) validMsgValue(amount) onUserAction {
    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);
    stakingPool.stake(amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    uint256 pTokenSharesAmount = IPToken(_pToken).mint(_msgSender(), pTokenAmount);
    emit PTokenMinted(_msgSender(), amount, pTokenAmount, pTokenSharesAmount);

    // mint yToken to Vault
    Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
    uint256 currentEpochEndTime = currentEpoch.startTime.add(currentEpoch.duration);
    require(block.timestamp < currentEpochEndTime, "Current epoch has ended");

    uint256 yTokenAmount = amount * (currentEpochEndTime - block.timestamp) / 3600;
    _yTokenTotalSupply[_currentEpochId.current()] = _yTokenTotalSupply[_currentEpochId.current()].add(yTokenAmount);
    _yTokenUserBalances[_currentEpochId.current()][address(this)] = _yTokenUserBalances[_currentEpochId.current()][address(this)].add(yTokenAmount);
    emit YTokenDummyMinted(_currentEpochId.current(), address(this), amount, yTokenAmount);
  }

  function swap(uint256 amount) external payable nonReentrant noneZeroAmount(amount) validMsgValue(amount) onUserAction {
    TokensTransfer.transferTokens(address(_assetToken), _msgSender(), address(this), amount);
    stakingPool.stake(amount);

    uint256 pTokenAmount = amount;
    IPToken(_pToken).rebase(pTokenAmount);

    uint256 yTokenAmount = amount * 3600; // testing only
    _yTokenTotalSupply[_currentEpochId.current()] = _yTokenTotalSupply[_currentEpochId.current()].add(yTokenAmount);
    _yTokenUserBalances[_currentEpochId.current()][_msgSender()] = _yTokenUserBalances[_currentEpochId.current()][_msgSender()].add(yTokenAmount);
    emit YTokenDummyMinted(_currentEpochId.current(), _msgSender(), amount, yTokenAmount);
  }

  function claimBribes(uint256 epochId) external nonReentrant validEpochId(epochId) onUserAction {
    uint256 yTokenBalance = _yTokenUserBalances[epochId][_msgSender()];
    require(yTokenBalance > 0, "No yToken balance");
    uint256 yTokenTotal= _yTokenTotalSupply[epochId];
    require(yTokenTotal >= yTokenBalance, "Invalid yToken balance");

    _yTokenUserBalances[epochId][_msgSender()] = 0;
    _yTokenTotalSupply[epochId] = yTokenTotal.sub(yTokenBalance);
    emit YTokenDummyBurned(epochId, _msgSender(), yTokenBalance);

    stakingPool.getReward();

    address[] memory rewardTokens = stakingPool.rewardTokens();
    for (uint i; i < rewardTokens.length; i++) {
      address rewardToken = rewardTokens[i];
      uint256 totalRewards = IERC20(rewardToken).balanceOf(address(this));
      uint256 reward = totalRewards.mul(yTokenBalance).div(yTokenTotal);
      if (reward > 0) {
        TokensTransfer.transferTokens(rewardToken, address(this), _msgSender(), reward);
        emit BribePaid(rewardToken, _msgSender(), reward);
      }
    }

  }

  
  /* ========== RESTRICTED FUNCTIONS ========== */



  /* ========== INTERNAL FUNCTIONS ========== */

  function _onEndEpoch(uint256 epochId) internal {
    Constants.Epoch memory epoch = _epochs[epochId];

    RedeemPool redeemPool = RedeemPool(epoch.redeemPool);

    uint256 totalRedeemingPTokens = redeemPool.totalRedeemingBalance();
    IPToken(_pToken).burn(address(redeemPool), totalRedeemingPTokens);

    uint256 assetAmount = totalRedeemingPTokens;
    stakingPool.withdraw(assetAmount);
    TokensTransfer.transferTokens(address(_assetToken), address(this), address(redeemPool), assetAmount);

    redeemPool.notifySettlement(assetAmount);
  }

  function _startNewEpoch() internal {
    _currentEpochId.increment();

    uint256 epochId = _currentEpochId.current();
    _allEpochIds.pushBack(bytes32(epochId));

    _epochs[epochId].epochId = epochId;
    _epochs[epochId].startTime = block.timestamp;
    _epochs[epochId].duration = settings.vaultParamValue(address(this), "EpochDuration");
    _epochs[epochId].redeemPool = address(new RedeemPool(address(this)));
  }

  /* ============== MODIFIERS =============== */

  modifier noneZeroAmount(uint256 amount) {
    require(amount > 0, "Amount must be greater than 0");
    _;
  }

  modifier validMsgValue(uint256 value) {
    if (address(_assetToken) == Constants.NATIVE_TOKEN) {
      require(msg.value == value, "Invalid msg value");
    }
    else {
      require(msg.value == 0, "msg.value should be 0");
    }
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

    _;
  }

  /* =============== EVENTS ============= */


  event PTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyMinted(uint256 indexed epochId, address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount);
  
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenDummyBurned(uint256 indexed epochId, address indexed user, uint256 yTokenAmount);

  event BribePaid(address indexed bribeToken, address indexed user, uint256 amount);

}
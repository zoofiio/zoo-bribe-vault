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
import "../interfaces/IYToken.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";
import "../tokens/YToken.sol";
import "./TokenPot.sol";
import "./RedeemPool.sol";

contract Vault is IVault, ReentrancyGuard, ProtocolOwner {
  using Counters for Counters.Counter;
  using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
  using SafeMath for uint256;
  using Strings for uint256;

  IProtocolSettings public immutable settings;
  TokenPot public immutable tokenPot;

  address internal immutable _assetToken;
  address internal immutable _pToken;

  Counters.Counter internal _currentEpochId;  // default to 0
  DoubleEndedQueue.Bytes32Deque internal _allEpochIds;   // all Epoch Ids, start from 1
  mapping(uint256 => Constants.Epoch) internal _epochs;  // epoch id => epoch info

  // mapping(address => Constants.RedeemByPToken) internal _userRedeemsByPToken;

  constructor(
    address _protocol,
    address _settings,
    address _assetToken_,
    address _pToken_
  ) ProtocolOwner(_protocol) {
    require(
      _settings != address(0) && _assetToken_ != address(0) && _pToken_ != address(0),
      "Zero address detected"
    );
    require(_assetToken_ != Constants.NATIVE_TOKEN, "Asset token cannot be NATIVE_TOKEN");

    tokenPot = new TokenPot(_protocol, _settings);
    _assetToken = _assetToken_;
    _pToken = _pToken_;

    settings = IProtocolSettings(_settings);
  }

  /* ================= VIEWS ================ */

  function assetBalance() public view override returns (uint256) {
    return tokenPot.balance(_assetToken);
  }

  function assetToken() public view override returns (address) {
    return _assetToken;
  }

  function pToken() public view override returns (address) {
    return _pToken;
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

  function paramValue(bytes32 param) public view override returns (uint256) {
    return settings.vaultParamValue(address(this), param);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function depoit(uint256 amount) external payable nonReentrant noneZeroAmount(amount) validMsgValue(amount) onUserAction {
    TokensTransfer.transferTokens(_assetToken, _msgSender(), address(tokenPot), amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    uint256 pTokenSharesAmount = IPToken(_pToken).mint(_msgSender(), pTokenAmount);
    emit PTokenMinted(_msgSender(), amount, pTokenAmount, pTokenSharesAmount);

    // mint yToken to Vault
    Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
    uint256 currentEpochEndTime = currentEpoch.startTime.add(currentEpoch.duration);
    require(block.timestamp < currentEpochEndTime, "Current epoch has ended");
    uint256 yTokenAmount = amount * (currentEpochEndTime - block.timestamp) / 3600;
    IYToken(currentEpoch.yToken).mint(address(this), yTokenAmount);
    emit YTokenMinted(address(this), amount, yTokenAmount);
  }

  function swap(uint256 amount) external payable nonReentrant noneZeroAmount(amount) validMsgValue(amount) onUserAction {
    TokensTransfer.transferTokens(_assetToken, _msgSender(), address(tokenPot), amount);

    uint256 pTokenAmount = amount;
    IPToken(_pToken).rebase(pTokenAmount);

    Constants.Epoch memory currentEpoch = _epochs[_currentEpochId.current()];
    uint256 yTokenAmount = amount * 3600; // testing only
    IYToken(currentEpoch.yToken).mint(_msgSender(), yTokenAmount);
    emit YTokenMinted(_msgSender(), amount, yTokenAmount);

  }

  
  /* ========== RESTRICTED FUNCTIONS ========== */



  /* ========== INTERNAL FUNCTIONS ========== */

  function _onEndEpoch(uint256 epochId) internal {
    Constants.Epoch memory epoch = _epochs[epochId];

    RedeemPool redeemPool = RedeemPool(epoch.redeemPool);

    uint256 totalRedeemingPTokens = redeemPool.totalRedeemingBalance();
    IPToken(_pToken).burn(address(redeemPool), totalRedeemingPTokens);

    uint256 assetAmount = totalRedeemingPTokens;
    tokenPot.withdraw(address(redeemPool), _assetToken, assetAmount);

    redeemPool.notifySettlement(assetAmount);
  }

  function _startNewEpoch() internal {
    _currentEpochId.increment();

    uint256 epochId = _currentEpochId.current();
    _allEpochIds.pushBack(bytes32(epochId));

    _epochs[epochId].epochId = epochId;
    _epochs[epochId].startTime = block.timestamp;
    _epochs[epochId].duration = settings.vaultParamValue(address(this), "EpochDuration");

    (string memory yTokenName, string memory yTokenSymbol) = _generateYTokenNameAndSymbol(epochId);
    _epochs[epochId].yToken = address(new YToken(yTokenName, yTokenSymbol));
    _epochs[epochId].redeemPool = address(new RedeemPool(address(this)));
  }

  function _generateYTokenNameAndSymbol(uint256 epochId) internal view returns (string memory, string memory) {
    string memory assetTokenSymbol = IERC20Metadata(_assetToken).symbol();
    string memory epochIdStr = epochId.toString();
    string memory yTokenSymbol = string(abi.encodePacked("y", assetTokenSymbol, epochIdStr));
    string memory yTokenName = string(abi.encodePacked("Zoo ", yTokenSymbol));
    return (yTokenName, yTokenSymbol);
  }



  /* ============== MODIFIERS =============== */

  modifier noneZeroAmount(uint256 amount) {
    require(amount > 0, "Amount must be greater than 0");
    _;
  }

  modifier validMsgValue(uint256 value) {
    if (_assetToken == Constants.NATIVE_TOKEN) {
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
  event YTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount);
  
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount);
  event YTokenBurned(address indexed user, uint256 yTokenAmount);

}
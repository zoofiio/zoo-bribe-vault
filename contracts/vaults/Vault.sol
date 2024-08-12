// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../interfaces/IPToken.sol";
import "../interfaces/IPToken.sol";
import "../interfaces/IYToken.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";
import "./TokenPot.sol";

contract Vault is IVault, ReentrancyGuard, ProtocolOwner {
  using SafeMath for uint256;

  IProtocolSettings public immutable settings;
  TokenPot public immutable tokenPot;

  address internal immutable _assetToken;
  address internal immutable _pToken;
  address internal immutable _yToken;

  constructor(
    address _protocol,
    address _settings,
    address _assetToken_,
    address _pToken_,
    address _yToken_
  ) ProtocolOwner(_protocol) {
    require(
      _settings != address(0) && _assetToken_ != address(0) && _pToken_ != address(0) && _yToken_ != address(0),
      "Zero address detected"
    );

    tokenPot = new TokenPot(_protocol, _settings);
    _assetToken = _assetToken_;
    _pToken = _pToken_;
    _yToken = _yToken_;

    settings = IProtocolSettings(_settings);
  }

  receive() external payable {
    require(_assetToken == Constants.NATIVE_TOKEN);
    TokensTransfer.transferTokens(_assetToken, address(this), address(tokenPot), msg.value);
  }

  /* ================= VIEWS ================ */

  function assetBalance() public view override returns (uint256) {
    return tokenPot.balance(_assetToken);
  }

  function assetToken() public view override returns (address) {
    return _assetToken;
  }

  function assetTokenDecimals() public view override returns (uint8) {
    return this.vaultAssetTokenDecimals();
  }

  function pToken() public view override returns (address) {
    return _pToken;
  }

  function yToken() public view override returns (address) {
    return _yToken;
  }

  function paramValue(bytes32 param) public view override returns (uint256) {
    return settings.vaultParamValue(address(this), param);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function depoit(uint256 amount) external payable nonReentrant noneZeroAmount(amount) validMsgValue(amount) onUserAction {
    
  }

  

  /* ========== RESTRICTED FUNCTIONS ========== */


  /* ========== INTERNAL FUNCTIONS ========== */


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

  modifier onlyOwnerOrProtocol() {
    require(_msgSender() == address(protocol) || _msgSender() == owner());
    _;
  }

  modifier onUserAction() {

  }

  /* =============== EVENTS ============= */


  event PTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 pTokenAmount, uint256 pTokenSharesAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  event YTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 yTokenAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  
  event PTokenBurned(address indexed user, uint256 pTokenAmount, uint256 pTokenSharesAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  event YTokenBurned(address indexed user, uint256 yTokenAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  
}
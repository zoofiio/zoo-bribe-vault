// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../libs/StableVaultCalculator.sol";
import "../interfaces/IZooProtocol.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IPriceFeed.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IUsd.sol";
import "../interfaces/IMarginToken.sol";
import "../settings/ProtocolOwner.sol";
import "./TokenPot.sol";

contract StableVault is IVault, ReentrancyGuard, ProtocolOwner {
  using SafeMath for uint256;
  using StableVaultCalculator for StableVault;

  bool internal _mintPaused;
  bool internal _redeemPaused;
  bool internal _usdToMarginTokensPaused;

  IProtocolSettings public immutable settings;
  TokenPot public immutable tokenPot;

  address internal immutable _assetToken;
  address internal immutable _usdToken;
  address internal immutable _marginToken;

  uint256 internal _usdTotalSupply;

  uint256 internal _lastYieldsSettlementTime;
  uint256 internal _previousAAR;
  uint256 internal _aarBelowSafeLineTime;

  IPriceFeed public priceFeed;

  constructor(
    address _protocol,
    address _settings,
    address _assetToken_,
    address _marginToken_,
    address _assetTokenPriceFeed_
  ) ProtocolOwner(_protocol) {
    require(
      _protocol != address(0) && _settings != address(0) && _assetToken_ != address(0) && _marginToken_ != address(0) && _assetTokenPriceFeed_ != address(0), 
      "Zero address detected"
    );

    require((tx.origin == protocol.protocolOwner()) || (_msgSender() == protocol.protocolOwner()) , "Vault should only be created by protocol owner");

    tokenPot = new TokenPot(_protocol, _settings);

    _assetToken = _assetToken_;
    _marginToken = _marginToken_;
    _usdToken = protocol.usdToken();

    settings = IProtocolSettings(_settings);

    _mintPaused = false;
    _redeemPaused = false;
    _usdToMarginTokensPaused = false;
    priceFeed = IPriceFeed(_assetTokenPriceFeed_);
  }

  receive() external payable {
    require(_assetToken == Constants.NATIVE_TOKEN);
    TokensTransfer.transferTokens(_assetToken, address(this), address(tokenPot), msg.value);
  }

  /* ================= VIEWS ================ */

  function paused() external view virtual returns (bool, bool, bool) {
    return (_mintPaused, _redeemPaused, _usdToMarginTokensPaused);
  }

  function vaultType() external pure override returns (Constants.VaultType) {
    return Constants.VaultType.Stable;
  }

  function usdToken() external view override returns (address) {
    return _usdToken;
  }

  function usdTotalSupply() public view override returns (uint256) {
    return _usdTotalSupply;
  }

  function assetBalance() external view override returns (uint256) {
    return tokenPot.balance(_assetToken);
  }

  function assetToken() public view override returns (address) {
    return _assetToken;
  }

  function assetTokenDecimals() public view override returns (uint8) {
    if (_assetToken == Constants.NATIVE_TOKEN) {
      return 18;
    }
    return IERC20Metadata(_assetToken).decimals();
  }

  function assetTokenPrice() external view override returns (uint256, uint256) {
    return _assetTokenPrice();
  }

  function marginToken() public view override returns (address) {
    return _marginToken;
  }

  function paramValue(bytes32 param) public view override returns (uint256) {
    return settings.vaultParamValue(address(this), param);
  }

  function vaultMode() external pure override returns (Constants.VaultMode) {
    revert("Not supported");
  }

  function AARDecimals() public pure returns (uint256) {
    return Constants.PROTOCOL_DECIMALS;
  }

  function AARBelowSafeLineTime() public view returns (uint256) {
    return _aarBelowSafeLineTime;
  }

  function AARBelowCircuitBreakerLineTime() public pure returns (uint256) {
    revert("Not supported");
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function mintUsd(uint256 assetAmount) external payable nonReentrant whenMintNotPaused noneZeroValue(assetAmount) validMsgValue(assetAmount) onUserAction(true) {
    (Constants.StableVaultState memory S, uint256 usdOutAmount) = this.calcMintUsdFromStableVault(assetAmount);
    require(S.aar >= S.AARS, "AAR Below AARS");

    if (_assetToken == Constants.NATIVE_TOKEN) {
      TokensTransfer.transferTokens(_assetToken, address(this), address(tokenPot), assetAmount);
    }
    else {
      TokensTransfer.transferTokens(_assetToken, _msgSender(), address(tokenPot), assetAmount);
    }

    uint256 usdSharesAmount = IUsd(_usdToken).mint(_msgSender(), usdOutAmount);
    _usdTotalSupply = _usdTotalSupply.add(usdOutAmount);
    emit UsdMinted(_msgSender(), assetAmount, usdOutAmount, usdSharesAmount, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function mintMarginTokens(uint256 assetAmount) external payable nonReentrant whenMintNotPaused noneZeroValue(assetAmount) validMsgValue(assetAmount) onUserAction(true) {
    (Constants.StableVaultState memory S, uint256 marginTokenOutAmount) = this.calcMintMarginTokensFromStableVault(assetAmount);

    if (_assetToken == Constants.NATIVE_TOKEN) {
      TokensTransfer.transferTokens(_assetToken, address(this), address(tokenPot), assetAmount);
    }
    else {
      TokensTransfer.transferTokens(_assetToken, _msgSender(), address(tokenPot), assetAmount);
    }

    IMarginToken(_marginToken).mint(_msgSender(), marginTokenOutAmount);
    emit MarginTokenMinted(_msgSender(), assetAmount, marginTokenOutAmount, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function mintPairs(uint256 assetAmount) external payable nonReentrant whenMintNotPaused noneZeroValue(assetAmount) validMsgValue(assetAmount) onUserAction(true) {
    (Constants.StableVaultState memory S, uint256 usdOutAmount, uint256 marginTokenOutAmount) = this.calcMintPairsFromStableVault(assetAmount);

    if (_assetToken == Constants.NATIVE_TOKEN) {
      TokensTransfer.transferTokens(_assetToken, address(this), address(tokenPot), assetAmount);
    }
    else {
      TokensTransfer.transferTokens(_assetToken, _msgSender(), address(tokenPot), assetAmount);
    }

    uint256 usdSharesAmount = IUsd(_usdToken).mint(_msgSender(), usdOutAmount);
    _usdTotalSupply = _usdTotalSupply.add(usdOutAmount);
    emit UsdMinted(_msgSender(), assetAmount, usdOutAmount, usdSharesAmount, S.P_USDC, S.P_USDC_DECIMALS);

    IMarginToken(_marginToken).mint(_msgSender(), marginTokenOutAmount);
    emit MarginTokenMinted(_msgSender(), assetAmount, marginTokenOutAmount, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function redeemByUsd(uint256 usdAmount) external nonReentrant whenRedeemNotPaused noneZeroValue(usdAmount) onUserAction(true) {
    require(usdAmount <= IUsd(_usdToken).balanceOf(_msgSender()), "Not enough zUSD balance");

    (Constants.StableVaultState memory S, , uint256 netRedeemAmount, uint256 feesToTreasury) = this.calcRedeemByUsdFromStableVault(settings, usdAmount);

    _doRedeem(netRedeemAmount, feesToTreasury, S, usdAmount, 0);
    emit AssetRedeemedWithUsd(_msgSender(), usdAmount, netRedeemAmount, feesToTreasury, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function redeemByMarginTokens(uint256 marginTokenAmount) external nonReentrant whenRedeemNotPaused noneZeroValue(marginTokenAmount) onUserAction(true) {
    require(marginTokenAmount <= IMarginToken(_marginToken).balanceOf(_msgSender()), "Not enough margin token balance");

    (Constants.StableVaultState memory S, , uint256 netRedeemAmount, uint256 feesToTreasury) = this.calcRedeemByMarginTokensFromStableVault(settings, marginTokenAmount);
    require(S.aar >= S.AARS, "AAR Below AARS");
    _doRedeem(netRedeemAmount, feesToTreasury, S, 0, marginTokenAmount);
    emit AssetRedeemedWithMarginTokens(_msgSender(), marginTokenAmount, netRedeemAmount, feesToTreasury, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function redeemByPairsWithExpectedUsdAmount(uint256 usdAmount) external nonReentrant whenRedeemNotPaused noneZeroValue(usdAmount) onUserAction(true) {
    require(usdAmount <= IUsd(_usdToken).balanceOf(_msgSender()), "Not enough zUSD balance");

    uint256 pairdMarginTokenAmount = this.calcPairdMarginTokenAmountForStableVault(usdAmount);
    require(pairdMarginTokenAmount <= IMarginToken(_marginToken).balanceOf(_msgSender()), "Not enough margin token balance");

    (Constants.StableVaultState memory S, , uint256 netRedeemAmount, uint256 feesToTreasury) = this.calcRedeemByPairsAssetAmountForStableVault(settings, pairdMarginTokenAmount);
    _doRedeem(netRedeemAmount, feesToTreasury, S, usdAmount, pairdMarginTokenAmount);

    emit AssetRedeemedWithPairs(_msgSender(), usdAmount, pairdMarginTokenAmount, netRedeemAmount, feesToTreasury, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function redeemByPairsWithExpectedMarginTokenAmount(uint256 marginTokenAmount) external nonReentrant whenRedeemNotPaused noneZeroValue(marginTokenAmount) onUserAction(true) {
    require(marginTokenAmount <= IMarginToken(_marginToken).balanceOf(_msgSender()), "Not enough margin token balance");
    
    uint256 pairedUsdAmount = this.calcPairedUsdAmountForStableVault(marginTokenAmount);
    require(pairedUsdAmount <= IUsd(_usdToken).balanceOf(_msgSender()), "Not enough zUSD balance");

    (Constants.StableVaultState memory S, , uint256 netRedeemAmount, uint256 feesToTreasury) = this.calcRedeemByPairsAssetAmountForStableVault(settings, marginTokenAmount);
    _doRedeem(netRedeemAmount, feesToTreasury, S, pairedUsdAmount, marginTokenAmount);

    emit AssetRedeemedWithPairs(_msgSender(), pairedUsdAmount, marginTokenAmount, netRedeemAmount, feesToTreasury, S.P_USDC, S.P_USDC_DECIMALS);
  }

  function usdToMarginTokens(uint256 usdAmount) external nonReentrant whenUsdToMarginTokensNotPaused noneZeroValue(usdAmount) onUserAction(false) {  
    require(usdAmount <= IUsd(_usdToken).balanceOf(_msgSender()), "Not enough zUSD balance");

    (Constants.StableVaultState memory S, uint256 marginTokenOut) = this.calcUsdToMarginTokensForStableVault(settings, usdAmount);

    uint256 usdSharesAmount = IUsd(_usdToken).burn(_msgSender(), usdAmount);
    _usdTotalSupply = _usdTotalSupply.sub(usdAmount);
    emit UsdBurned(_msgSender(), usdAmount, usdSharesAmount, S.P_USDC, S.P_USDC_DECIMALS);

    IMarginToken(_marginToken).mint(_msgSender(), marginTokenOut);
    emit MarginTokenMinted(_msgSender(), 0, marginTokenOut, S.P_USDC, S.P_USDC_DECIMALS);

    emit UsdToMarginTokens(_msgSender(), usdAmount, marginTokenOut, S.P_USDC, S.P_USDC_DECIMALS);
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function pauseMint() external nonReentrant onlyOwner {
    _mintPaused = true;
    emit MintPaused();
  }

  function unpauseMint() external nonReentrant onlyOwner {
    _mintPaused = false;
    emit MintUnpaused();
  }

  function pauseRedeem() external nonReentrant onlyOwner {
    _redeemPaused = true;
    emit RedeemPaused();
  }

  function unpauseRedeem() external nonReentrant onlyOwner {
    _redeemPaused = false;
    emit RedeemUnpaused();
  }

  function pauseUsdToMarginTokens() external nonReentrant onlyOwner {
    _usdToMarginTokensPaused = true;
    emit UsdToMarginTokensPaused();
  }

  function unpauseUsdToMarginTokens() external nonReentrant onlyOwner {
    _usdToMarginTokensPaused = false;
    emit UsdToMarginTokensUnpaused();
  }

  function updatePriceFeed(address _assetTokenPriceFeed_) external nonReentrant onlyOwner {
    require(_assetTokenPriceFeed_ != address(0), "Zero address detected");
    priceFeed = IPriceFeed(_assetTokenPriceFeed_);
  }

  function _doRedeem(uint256 netRedeemAmount, uint256 feesToTreasury, Constants.StableVaultState memory S, uint256 usdAmount, uint256 marginTokenAmount) internal {
    require(netRedeemAmount.add(feesToTreasury) <= tokenPot.balance(_assetToken), "Not enough asset balance");

    if (netRedeemAmount > 0) {
      tokenPot.withdraw(_msgSender(), _assetToken, netRedeemAmount);
    }
    
    if (feesToTreasury > 0) {
      tokenPot.withdraw(settings.treasury(), _assetToken, feesToTreasury);
    }
    
    if (usdAmount > 0) {
      uint256 usdBurnShares = IUsd(_usdToken).burn(_msgSender(), usdAmount);
      _usdTotalSupply = _usdTotalSupply.sub(usdAmount);
      emit UsdBurned(_msgSender(), usdAmount, usdBurnShares, S.P_USDC, S.P_USDC_DECIMALS);
    }

    if (marginTokenAmount > 0) {
      IMarginToken(_marginToken).burn(_msgSender(), marginTokenAmount);
      emit MarginTokenBurned(_msgSender(), marginTokenAmount, S.P_USDC, S.P_USDC_DECIMALS);
    }
  }

  function _doSettleYields(uint256 yieldsBaseAssetAmount) internal {
    uint256 timeElapsed = block.timestamp.sub(_lastYieldsSettlementTime);
    uint256 Y = paramValue("Y");
    uint256 deltaAssetAmount = timeElapsed.mul(Y).mul(yieldsBaseAssetAmount).div(365 days).div(10 ** settings.decimals());

    if (deltaAssetAmount > 0) {
      (, uint256 usdOutAmount) = this.calcMintUsdFromStableVault(deltaAssetAmount);
      IUsd(_usdToken).rebase(usdOutAmount);
      _usdTotalSupply = _usdTotalSupply.add(usdOutAmount);
      emit YieldsSettlement(usdOutAmount);
    }
  }

  function _updateStateOnUserAction(uint256 previousAAR, uint256 afterAAR) internal {
    uint256 AARS = paramValue("AARS");

    if (previousAAR >= AARS && afterAAR < AARS) {
      _aarBelowSafeLineTime = block.timestamp;
    }
    else if (previousAAR < AARS && afterAAR >= AARS) {
      _aarBelowSafeLineTime = 0;
    }
  }

  function _assetTokenPrice() internal view returns (uint256, uint256) {
    return (priceFeed.latestPrice(), priceFeed.decimals());
  }

  /* ============== MODIFIERS =============== */

  modifier whenMintNotPaused() {
    require(!_mintPaused, "Mint paused");
    _;
  }

  modifier whenRedeemNotPaused() {
    require(!_redeemPaused, "Redeem paused");
    _;
  }

  modifier whenUsdToMarginTokensNotPaused() {
    require(!_usdToMarginTokensPaused, "zUSD to Margin Tokens paused");
    _;
  }

  modifier noneZeroValue(uint256 value) {
    require(value > 0, "Value must be greater than 0");
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

  modifier onUserAction(bool settleYields) {
    uint256 yieldsBaseAssetAmount = tokenPot.balance(_assetToken);

    _;

    if (settleYields) {
      if (_lastYieldsSettlementTime != 0) {
        _doSettleYields(yieldsBaseAssetAmount);
      }
      _lastYieldsSettlementTime = block.timestamp;
    }

    uint256 afterAAR = this.AAR();
    _updateStateOnUserAction(_previousAAR, afterAAR);

    _previousAAR = this.AAR();
  }

  /* =============== EVENTS ============= */

  event MintPaused();
  event MintUnpaused();
  event RedeemPaused();
  event RedeemUnpaused();
  event UsdToMarginTokensPaused();
  event UsdToMarginTokensUnpaused();

  event UsdMinted(address indexed user, uint256 assetTokenAmount, uint256 usdTokenAmount, uint256 usdSharesAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  event MarginTokenMinted(address indexed user, uint256 assetTokenAmount, uint256 marginTokenAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);

  event UsdBurned(address indexed user, uint256 usdTokenAmount, uint256 usdSharesAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  event MarginTokenBurned(address indexed user, uint256 marginTokenAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);

  event AssetRedeemedWithUsd(address indexed user, uint256 usdTokenAmount, uint256 netAssetAmount, uint256 feesToTreasury, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  event AssetRedeemedWithMarginTokens(address indexed user, uint256 marginTokenAmount, uint256 netAssetAmount, uint256 feesToTreasury, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);
  event AssetRedeemedWithPairs(address indexed user, uint256 usdAmount, uint256 marginTokenAmount, uint256 netAssetAmount, uint256 feesToTreasury, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);

  event UsdToMarginTokens(address indexed user, uint256 usdAmount, uint256 xTokenAmount, uint256 assetTokenPrice, uint256 assetTokenPriceDecimals);

  event YieldsSettlement(uint256 usdYieldsAmount);
}
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../interfaces/IMarginToken.sol";
import "../interfaces/IPtyPoolBuyLow.sol";
import "../interfaces/IPtyPoolSellHigh.sol";
import "../interfaces/IUsd.sol";
import "../interfaces/IVault.sol";
import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";

contract MockVault is IVault {
  address internal immutable _assetToken;
  address internal immutable _usdToken;
  address internal immutable _marginToken;

  Constants.VaultMode internal _vaultMode;

  IPtyPoolBuyLow public ptyPoolBuyLow;
  IPtyPoolSellHigh public ptyPoolSellHigh;

  constructor(
    address _assetToken_,
    address _usdToken_,
    address _marginToken_
  ) {
    _assetToken = _assetToken_;
    _usdToken = _usdToken_;
    _marginToken = _marginToken_;
    _vaultMode = Constants.VaultMode.Empty;
  }

  receive() external payable {}

  /* ========== IVault Functions ========== */

  function vaultType() external pure override returns (Constants.VaultType) {
    return Constants.VaultType.Volatile;
  }

  function AARDecimals() external pure returns (uint256) {
    return 0;
  }

  function usdToken() external view override returns (address) {
    return _usdToken;
  }

  function assetToken() external view override returns (address) {
    return _assetToken;
  }

  function assetTokenDecimals() public pure returns (uint8) {
    return 18;
  }
  
  function assetBalance() external pure returns (uint256) {
    return 0;
  }

  function assetTokenPrice() external pure returns (uint256, uint256) {
    return (0, 0);
  }

  function marginToken() external view returns (address) {
    return _marginToken;
  }

  function usdTotalSupply() external pure returns (uint256) {
    return 0;
  }

  function paramValue(bytes32) external pure returns (uint256) {
    return 0;
  }

  function vaultMode() external view override returns (Constants.VaultMode) {
    return _vaultMode;
  }

  function setPtyPools(address _ptyPoolBuyLow, address _ptyPoolSellHigh) external {
    ptyPoolBuyLow = IPtyPoolBuyLow(_ptyPoolBuyLow);
    ptyPoolSellHigh = IPtyPoolSellHigh(_ptyPoolSellHigh);
  }

  function AARBelowSafeLineTime() public pure returns (uint256) {
    return 0;
  }

  function AARBelowCircuitBreakerLineTime() public pure returns (uint256) {
    return 0;
  }

  /* ========== Mock Functions ========== */

  function mockSetVaultMode(Constants.VaultMode _vaultMode_) external {
    _vaultMode = _vaultMode_;
  }

  function mockAddStakingYieldsToPtyPoolBuyLow(uint256 marginTokenAmount) external {
    IMarginToken(_marginToken).mint(address(this), marginTokenAmount);
    TokensTransfer.transferTokens(_marginToken, address(this), address(ptyPoolBuyLow), marginTokenAmount);
    ptyPoolBuyLow.addStakingYields(marginTokenAmount);
  }

  function mockAddMatchingYieldsToPtyPoolBuyLow(uint256 assetAmount) payable external {
    TokensTransfer.transferTokens(_assetToken, msg.sender, address(this), assetAmount);
    TokensTransfer.transferTokens(_assetToken, address(this), address(ptyPoolBuyLow), assetAmount);
    ptyPoolBuyLow.addMatchingYields(assetAmount);
  }

  function mockMatchedPtyPoolBuyLow(uint256 deltaAssetAmount, uint256 deltaUsdAmount) payable external {
    TokensTransfer.transferTokens(_assetToken, msg.sender, address(this), deltaAssetAmount);
    TokensTransfer.transferTokens(_assetToken, address(this), address(ptyPoolBuyLow), deltaAssetAmount);

    IUsd(_usdToken).burn(address(ptyPoolBuyLow), deltaUsdAmount);
    ptyPoolBuyLow.notifyBuyLowTriggered(deltaAssetAmount);
  }

  function mockAddStakingYieldsToPtyPoolSellHigh(uint256 assetAmount) payable external {
    TokensTransfer.transferTokens(_assetToken, msg.sender, address(this), assetAmount);
    TokensTransfer.transferTokens(_assetToken, address(this), address(ptyPoolSellHigh), assetAmount);
    ptyPoolSellHigh.addStakingYields(assetAmount);
  }

  function mockAddMatchingYieldsToPtyPoolSellHigh(uint256 marginTokenAmount) external {
    IMarginToken(_marginToken).mint(address(this), marginTokenAmount);
    TokensTransfer.transferTokens(_marginToken, address(this), address(ptyPoolSellHigh), marginTokenAmount);
    ptyPoolSellHigh.addMatchingYields(marginTokenAmount);
  }

  function mockMatchedPtyPoolSellHigh(uint256 deltaAssetAmount, uint256 deltaUsdAmount) external {
    uint256 usdSharesAmount = IUsd(_usdToken).mint(address(ptyPoolSellHigh), deltaUsdAmount);
    ptyPoolSellHigh.notifySellHighTriggered(deltaAssetAmount, usdSharesAmount, address(this));
  }
}
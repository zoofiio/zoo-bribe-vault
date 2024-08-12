// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../libs/Constants.sol";
import "../libs/VaultCalculator.sol";
import "../libs/StableVaultCalculator.sol";
import "../interfaces/IVault.sol";
import "./Vault.sol";
import "./StableVault.sol";

contract VaultQuery {
  using VaultCalculator for Vault;
  using StableVaultCalculator for StableVault;

  function AAR(Vault vault) public view returns (uint256) {
    return vault.AAR();
  }

  function getVaultState(Vault vault) external view returns (Constants.VaultState memory) {
    return vault.getVaultState();
  }

  function calcMintPairs(Vault vault, uint256 assetAmount) external view returns (Constants.VaultState memory, uint256, uint256) {
    return vault.calcMintPairs(assetAmount);
  }

  function calcMintUsdAboveAARU(Vault vault, uint256 assetAmount) external view returns (Constants.VaultState memory, uint256) {
    return vault.calcMintUsdAboveAARU(assetAmount);
  }

  function calcMintMarginTokensBelowAARS(Vault vault, uint256 assetAmount) external view returns (Constants.VaultState memory, uint256) {
    return vault.calcMintMarginTokensBelowAARS(assetAmount);
  }

  function calcPairdMarginTokenAmount(Vault vault, uint256 usdAmount) external view returns (uint256) {
    return vault.calcPairdMarginTokenAmount(usdAmount);
  }

  function calcPairedUsdAmount(Vault vault, uint256 marginTokenAmount) external view returns (uint256) {
    return vault.calcPairedUsdAmount(marginTokenAmount);
  }

  function calcPairedRedeemAssetAmount(Vault vault, uint256 marginTokenAmount) external view returns (Constants.VaultState memory, uint256) {
    return vault.calcPairedRedeemAssetAmount(marginTokenAmount);
  }

  function calcRedeemByMarginTokenAboveAARU(Vault vault, uint256 marginTokenAmount) external view returns (Constants.VaultState memory, uint256) {
    return vault.calcRedeemByMarginTokenAboveAARU(marginTokenAmount);
  }

  function calcRedeemByUsdBelowAARS(Vault vault, uint256 usdAmount) external view returns (Constants.VaultState memory, uint256) {
    return vault.calcRedeemByUsdBelowAARS(usdAmount);
  }

  function calcUsdToMarginTokens(Vault vault, IProtocolSettings settings, uint256 usdAmount) external view returns (Constants.VaultState memory, uint256) {
    return vault.calcUsdToMarginTokens(settings, usdAmount);
  }

  function getStableVaultState(StableVault vault) external view returns (Constants.StableVaultState memory) {
    return vault.getStableVaultState();
  }

  function calcMintUsdFromStableVault(StableVault vault, uint256 assetAmount) external view returns (Constants.StableVaultState memory, uint256) {
    return vault.calcMintUsdFromStableVault(assetAmount);
  }

  function calcMintMarginTokensFromStableVault(StableVault vault, uint256 assetAmount) external view returns (Constants.StableVaultState memory, uint256) {
    return vault.calcMintMarginTokensFromStableVault(assetAmount);
  }

  function calcMintPairsFromStableVault(StableVault vault, uint256 assetAmount) public view returns (Constants.StableVaultState memory, uint256, uint256) {
    return vault.calcMintPairsFromStableVault(assetAmount);
  }

  function calcRedeemByUsdFromStableVault(StableVault vault, IProtocolSettings settings, uint256 usdAmount) external view returns (Constants.StableVaultState memory, uint256, uint256, uint256) {
    return vault.calcRedeemByUsdFromStableVault(settings, usdAmount);
  }

  function calcRedeemByMarginTokensFromStableVault(StableVault vault, IProtocolSettings settings, uint256 marginTokenAmount) external view returns (Constants.StableVaultState memory, uint256, uint256, uint256) {
    return vault.calcRedeemByMarginTokensFromStableVault(settings, marginTokenAmount);
  }

  function calcPairdMarginTokenAmountForStableVault(StableVault vault, uint256 usdAmount) external view returns (uint256) {
    return vault.calcPairdMarginTokenAmountForStableVault(usdAmount);
  }

  function calcPairedUsdAmountForStableVault(StableVault vault, uint256 marginTokenAmount) external view returns (uint256) {
    return vault.calcPairedUsdAmountForStableVault(marginTokenAmount);
  }

  function calcRedeemByPairsAssetAmountForStableVault(StableVault vault, IProtocolSettings settings, uint256 marginTokenAmount) external view returns (Constants.StableVaultState memory, uint256, uint256, uint256) {
    return vault.calcRedeemByPairsAssetAmountForStableVault(settings, marginTokenAmount);
  }

  function calcUsdToMarginTokensForStableVault(StableVault vault, IProtocolSettings settings, uint256 usdAmount) external view returns (Constants.StableVaultState memory, uint256) {
    return  vault.calcUsdToMarginTokensForStableVault(settings, usdAmount);
  }
}

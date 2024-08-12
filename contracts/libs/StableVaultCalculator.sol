// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./Constants.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IPtyPool.sol";
import "../interfaces/IUsd.sol";
import "../interfaces/IVault.sol";

library StableVaultCalculator {
  using SafeMath for uint256;

  // 𝑟 = self.RateR() × 𝑡(h𝑟𝑠), since aar drop below AARS;
  // r = 0 since aar above AARS;
  function _r(uint256 aarBelowSafeLineTime, uint256 rateR) internal view returns (uint256) {
    if (aarBelowSafeLineTime == 0) {
      return 0;
    }
    return rateR.mul(block.timestamp.sub(aarBelowSafeLineTime)).div(1 hours);
  }

  function AAR(IVault self) public view returns (uint256) {
    uint256 assetTotalAmount = self.assetBalance();
    if (assetTotalAmount == 0) {
      return 0;
    }
    if (self.usdTotalSupply() == 0) {
      return type(uint256).max;
    }
    (uint256 assetTokenPrice, uint256 assetTokenPriceDecimals) = self.assetTokenPrice();
    return assetTotalAmount.mul(assetTokenPrice).div(10 ** assetTokenPriceDecimals).mul(10 ** self.AARDecimals()).div(self.usdTotalSupply());
  }

  function getStableVaultState(IVault self) public view returns (Constants.StableVaultState memory) {
    Constants.StableVaultState memory S;
    S.M_USDC = self.assetBalance();
    (S.P_USDC, S.P_USDC_DECIMALS) = self.assetTokenPrice() ;
    S.M_USD_USDC = self.usdTotalSupply();
    S.M_USDCx = IERC20(self.marginToken()).totalSupply();
    S.aar = AAR(self);
    // S.AART = self.paramValue("AART");
    S.AARS = self.paramValue("AARS");
    // S.AARU = self.paramValue("AARU");
    // S.AARC = self.paramValue("AARC");
    S.AARDecimals = self.AARDecimals();
    S.RateR = self.paramValue("RateR");
    S.AARBelowSafeLineTime = self.AARBelowSafeLineTime();
    return S;
  }

  function calcMintUsdFromStableVault(IVault self, uint256 assetAmount) public view returns (Constants.StableVaultState memory, uint256) {
    require(assetAmount > 0, "Amount must be greater than 0");

    Constants.StableVaultState memory S = getStableVaultState(self);
    require(S.M_USDCx > 0, "Margin token balance is 0");

    // ΔUSD = ΔUSDC * P_USDC
    uint256 usdOutAmount = assetAmount.mul(S.P_USDC).div(10 ** S.P_USDC_DECIMALS);
    return (S, usdOutAmount);
  }

  function calcMintMarginTokensFromStableVault(IVault self, uint256 assetAmount) public view returns (Constants.StableVaultState memory, uint256) {
    require(assetAmount > 0, "Amount must be greater than 0");

    Constants.StableVaultState memory S = getStableVaultState(self);

    uint256 marginTokenOutAmount;
    if (S.M_USDCx == 0) {
      // ΔUSDCx = ΔUSDC
      marginTokenOutAmount = assetAmount;
    }
    else {
      uint256 aar101 = (101 * (10 ** (S.AARDecimals - 2)));
      if (S.aar >= aar101) { // aar >= 101% {
        // ΔUSDCx = ΔUSDC * P_USDC * M_USDCx / (M_USDC * P_USDC - M_USD_USDC)
        marginTokenOutAmount = assetAmount.mul(S.P_USDC).div(10 ** S.P_USDC_DECIMALS).mul(S.M_USDCx).div(
          S.M_USDC.mul(S.P_USDC).div(10 ** S.P_USDC_DECIMALS).sub(S.M_USD_USDC)
        );
      }
      else {
        // ΔUSDCx = ΔUSDC * P_USDC * M_USDCx * 100 / M_USD_USDC
        marginTokenOutAmount = assetAmount.mul(S.P_USDC).div(10 ** S.P_USDC_DECIMALS).mul(S.M_USDCx).mul(100).div(S.M_USD_USDC);
      }
    }

    return (S, marginTokenOutAmount);
  }

  function calcMintPairsFromStableVault(IVault self, uint256 assetAmount) public view returns (Constants.StableVaultState memory, uint256, uint256) {
    require(assetAmount > 0, "Amount must be greater than 0");

    Constants.StableVaultState memory S = getStableVaultState(self);
    require(S.M_USDCx > 0, "Margin token balance is 0");
    // require(S.aar < S.AARS, "AAR Above AARS");

    // ΔUSD = ΔUSDC * M_USD_USDC / M_USDC
    // ΔUSDCx = ΔUSD * M_USDCx / M_USD_USDC
    uint256 usdOutAmount = assetAmount.mul(S.M_USD_USDC).div(S.M_USDC);
    uint256 marginTokenOutAmount = usdOutAmount.mul(S.M_USDCx).div(S.M_USD_USDC);

    return (S, usdOutAmount, marginTokenOutAmount);
  }

  function calcRedeemFeesFromStableVault(IVault self, IProtocolSettings settings, uint256 assetAmount) public view returns (uint256, uint256) {
    uint256 totalFees = assetAmount.mul(self.paramValue("C")).div(10 ** settings.decimals());
    uint256 feesToTreasury = totalFees.mul(self.paramValue("TreasuryFeeRate")).div(10 ** settings.decimals());

    uint256 netRedeemAmount = assetAmount.sub(totalFees);
    return (netRedeemAmount, feesToTreasury);
  }

  function calcRedeemByUsdFromStableVault(IVault self, IProtocolSettings settings, uint256 usdAmount) public view returns (Constants.StableVaultState memory, uint256, uint256, uint256) {
    require(usdAmount > 0, "Amount must be greater than 0");

    Constants.StableVaultState memory S = getStableVaultState(self);

    uint256 assetOutAmount;
    if (S.aar >= (10 ** S.AARDecimals)) {
      // ΔUSDC = ΔUSD / P_USDC
      assetOutAmount = usdAmount.mul(10 ** S.P_USDC_DECIMALS).div(S.P_USDC);
    }
    else {
      // ΔUSDC = ΔUSD * M_USDC / M_USD_USDC
      assetOutAmount = usdAmount.mul(S.M_USDC).div(S.M_USD_USDC);
    }

    (uint256 netRedeemAmount, uint256 feesToTreasury) = calcRedeemFeesFromStableVault(self, settings, assetOutAmount);
    return (S, assetOutAmount, netRedeemAmount, feesToTreasury);
  }

  function calcRedeemByMarginTokensFromStableVault(IVault self, IProtocolSettings settings, uint256 marginTokenAmount) public view returns (Constants.StableVaultState memory, uint256, uint256, uint256) {
    require(marginTokenAmount > 0, "Amount must be greater than 0");

    Constants.StableVaultState memory S = getStableVaultState(self);

    // ΔUSDC = M_USDC * ΔUSDCx / M_USDCx - M_USD_USDC * ΔUSDCx / (M_USDCx * P_USDC)
    uint256 a = S.M_USDC.mul(marginTokenAmount).div(S.M_USDCx);
    uint256 b = S.M_USD_USDC.mul(marginTokenAmount).div(S.M_USDCx.mul(S.P_USDC).div(10 ** S.P_USDC_DECIMALS));
    uint256 assetOutAmount = a > b ? a - b : 0;

    (uint256 netRedeemAmount, uint256 feesToTreasury) = calcRedeemFeesFromStableVault(self, settings, assetOutAmount);
    return (S, assetOutAmount, netRedeemAmount, feesToTreasury);
  }

  function calcPairdMarginTokenAmountForStableVault(IVault self, uint256 usdAmount) public view returns (uint256) {
    require(usdAmount > 0, "Amount must be greater than 0");
    Constants.StableVaultState memory S = getStableVaultState(self);
    // require(S.aar < S.AARS, "AAR Above AARS");

    // ΔUSD = ΔUSDCx * M_USD_USDC / M_USDCx
    // ΔUSDCx = ΔUSD * M_USDCx / M_USD_USDC
    uint256 marginTokenOutAmount = usdAmount.mul(S.M_USDCx).div(S.M_USD_USDC);
    return marginTokenOutAmount;
  }

  function calcPairedUsdAmountForStableVault(IVault self, uint256 marginTokenAmount) public view returns (uint256) {
    require(marginTokenAmount > 0, "Amount must be greater than 0");
    Constants.StableVaultState memory S = getStableVaultState(self);
    // require(S.aar < S.AARS, "AAR Above AARS");

    // ΔUSDCx = ΔUSD * M_USDCx / M_USD_USDC
    // ΔUSD = ΔUSDCx * M_USD_USDC / M_USDCx
    uint256 usdOutAmount = marginTokenAmount.mul(S.M_USD_USDC).div(S.M_USDCx);
    return usdOutAmount;
  }

  function calcRedeemByPairsAssetAmountForStableVault(IVault self, IProtocolSettings settings, uint256 marginTokenAmount) public view returns (Constants.StableVaultState memory, uint256, uint256, uint256) {
    Constants.StableVaultState memory S = getStableVaultState(self);

    // ΔUSDC = ΔUSDCx * M_USDC / M_USDCx
    uint256 assetOutAmount = marginTokenAmount.mul(S.M_USDC).div(S.M_USDCx);
    (uint256 netRedeemAmount, uint256 feesToTreasury) = calcRedeemFeesFromStableVault(self, settings, assetOutAmount);
    return (S, assetOutAmount, netRedeemAmount, feesToTreasury);
  }

  function calcUsdToMarginTokensForStableVault(IVault self, IProtocolSettings settings, uint256 usdAmount) public view returns (Constants.StableVaultState memory, uint256) {
    Constants.StableVaultState memory S = getStableVaultState(self);
    require(S.aar < S.AARS, "AAR Above AARS");

    uint256 aar101 = (101 * (10 ** (S.AARDecimals - 2)));
    uint256 marginTokenOutAmount;
    
    if (S.aar >= aar101) { // aar >= 101% 
      // ΔUSDCx = ΔUSD * M_USDCx * (1 + r) / (M_USDC * P_USDC - M_USD-USDC)
      Constants.Terms memory T;
      T.T1 = usdAmount.mul(S.M_USDCx).mul((10 ** settings.decimals()).add(_r(S.AARBelowSafeLineTime, S.RateR)));
      marginTokenOutAmount = T.T1.div(
        S.M_USDC.mul(S.P_USDC).div(10 ** S.P_USDC_DECIMALS).sub(S.M_USD_USDC)
      ).div(10 ** settings.decimals());
    }
    else { //  aar < 101% 
      // ΔUSDCx = ΔUSD * M_USDCx * 100 / M_USD-USDC
      marginTokenOutAmount = usdAmount.mul(S.M_USDCx).mul(100).div(S.M_USD_USDC);
    }
    return (S, marginTokenOutAmount);
  }
}
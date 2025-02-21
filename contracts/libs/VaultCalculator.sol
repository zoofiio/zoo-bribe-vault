// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./Constants.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IRedeemPool.sol";
import "../interfaces/IVault.sol";

library VaultCalculator {
  using EnumerableSet for EnumerableSet.AddressSet;
  using Math for uint256;

  uint256 public constant SCALE = 10 ** 18;

  function calcNewEpochS(IVault self) public view returns (uint256) {
    address pToken = self.pToken();
    uint256 pTokenTotalSupply = IERC20(pToken).totalSupply();

    Constants.Epoch memory epoch = self.epochInfoById(self.currentEpochId());
    IRedeemPool redeemPool = IRedeemPool(epoch.redeemPool);
    uint256 pTokenRedeemingAmount = redeemPool.totalRedeemingBalance();

    return pTokenTotalSupply - pTokenRedeemingAmount;
  }

  function calcY(IVault self) public view returns (uint256) {
    uint256 epochId = self.currentEpochId();

    uint256 X = self.epochNextSwapX(epochId);
    uint256 k0 = self.epochNextSwapK0(epochId);   // scale: 1

    uint256 deltaT = 0;
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime + epoch.duration >= block.timestamp) {
      // in current epoch
      deltaT = block.timestamp - epoch.startTime;
    }
    else {
      // in a new epoch
      uint256 S = calcNewEpochS(self);
      (X, k0) = calcInitSwapParams(self, S);
    }

    // Y = k0 / (X * (1 + ∆t / 86400)2) = k0 / X / (1 + ∆t / 86400) / (1 + ∆t / 86400)
    uint256 scale = 10 ** Constants.PROTOCOL_DECIMALS;
    uint256 decayPeriod = self.paramValue("D") / 30;
    uint256 Y = k0.mulDiv(
      scale,
      scale + deltaT.mulDiv(scale, decayPeriod)
    ).mulDiv(
      scale,
      scale + deltaT.mulDiv(scale, decayPeriod)
    ) / X;

    return Y;
  }

  function calcInitSwapParams(IVault self, uint256 S) public view returns (uint256, uint256) {
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");

    uint256 X = S;

    // Y0 = X * APRi * D / 86400 / 365
    uint256 Y0 = X.mulDiv(APRi * D, 86400 * 365);   // scale: 10 ** 10

    // k0 = X * Y0
    uint256 k0 = X.mulDiv(Y0, 10 ** Constants.PROTOCOL_DECIMALS);   // scale: 1

    return (X, k0);
  }

  function updateSwapParamsOnDeposit(IVault self, uint256 m) public view returns (uint256, uint256) {
    uint256 epochId = self.currentEpochId(); 

    // X' = X + m
    uint256 X = self.epochNextSwapX(epochId);
    uint256 k0 = self.epochNextSwapK0(epochId);
    uint256 X_updated = X + m;

    // k'0 = ((X + m) / X)^2 * k0 = (X + m) * (X + m) * k0 / X / X = X' * X' * k0 / X / X
    uint256 k0_updated = X_updated.mulDiv(X_updated, X).mulDiv(k0, X);  // scale: 1

    return (X_updated, k0_updated);
  }

  function doCalcSwap(IVault self, uint256 n) public view returns (uint256, uint256) {
    uint256 epochId = self.currentEpochId();
    uint256 X = self.epochNextSwapX(epochId);
    uint256 k0 = self.epochNextSwapK0(epochId); // scale: 1

    uint256 deltaT = 0;
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime + epoch.duration >= block.timestamp) {
      // in current epoch
      deltaT = block.timestamp - epoch.startTime;
    } 
    else {
      // in a new epoch
      uint256 S = calcNewEpochS(self);
      (X, k0) = calcInitSwapParams(self, S);
    }

    // X' = X * k0 / (k0 + X * n * (1 + ∆t / 86400)2)

    uint256 decayPeriod = self.paramValue("D") / 30;
    uint256 T1 = SCALE + (
      deltaT.mulDiv(SCALE, decayPeriod)
    );  // scale: 18

    // X * n * (1 + ∆t / 86400)2
    uint256 T2 = X.mulDiv(n.mulDiv(T1 * T1, SCALE), SCALE);   // scale: 1

    // k0 + X * n * (1 + ∆t / 86400)2
    uint256 T3 = k0 + T2;

    // X' = X * k0 / (k0 + X * n * (1 + ∆t / 86400)2)
    uint256 X_updated = X.mulDiv(k0, T3);

    // m = X - X'
    uint256 m = X - X_updated;

    return (X_updated, m);
  }

}
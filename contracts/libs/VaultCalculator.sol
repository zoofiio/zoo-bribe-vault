// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./Constants.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IVault.sol";

library VaultCalculator {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeMath for uint256;

  uint256 public constant SCALE = 10 ** 18;

  function calcY(IVault self) public view returns (uint256) {
    uint256 epochId = self.currentEpochId();

    uint256 deltaT = 0;
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
      // in current epoch
      deltaT = block.timestamp.sub(epoch.startTime);
    } 
    else {
      // in a new epoch
      deltaT = 0;
    }

    // Y = k0 / (X * (1 + ∆t / 86400)2) = k0 / X / (1 + ∆t / 86400) / (1 + ∆t / 86400)
    uint256 X = self.epochNextSwapX(epochId);
    require(X > 0, "Invalid X");
    uint256 k0 = self.epochNextSwapK0(epochId);   // scale: 10 ** 10
    uint256 SettingsScale = 10 ** Constants.PROTOCOL_DECIMALS;
    uint256 decayPeriod = self.paramValue("D").div(30);
    uint256 Y = k0.div(X).mul(SettingsScale).div(
      SettingsScale + deltaT.mul(SettingsScale).div(decayPeriod)
    ).mul(SettingsScale).div(
      SettingsScale + deltaT.mul(SettingsScale).div(decayPeriod)
    ).div(SettingsScale);

    return Y;
  }

  function calcInitSwapParams(IVault self, uint256 S) public view returns (uint256, uint256) {
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");

    uint256 X = S;

    // Y0 = X * APRi * D / 86400 / 365
    uint256 Y0 = X.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10

    // k0 = X * Y0
    uint256 k0 = X.mul(Y0);   // scale: 10 ** 10

    return (X, k0);
  }

  function updateSwapParamsOnDeposit(IVault self, uint256 m) public view returns (uint256, uint256) {
    uint256 epochId = self.currentEpochId(); 

    // X' = X + m
    uint256 X = self.epochNextSwapX(epochId);
    uint256 k0 = self.epochNextSwapK0(epochId);
    uint256 X_updated = X.add(m);
    console.log("updateSwapParamsOnDeposit, X: %s, k0: %s, X_updated: %s", X, k0, X_updated);

    // k'0 = ((X + m) / X)^2 * k0 = (X + m) * (X + m) * k0 / X / X = X' * X' * k0 / X / X
    uint256 k0_updated = X_updated.mul(X_updated).div(X).mul(k0).div(X);  // scale: 10 ** 10
    console.log("updateSwapParamsOnDeposit, k0_updated: %s", k0_updated);

    return (X_updated, k0_updated);
  }

  function doCalcSwap(IVault self, uint256 n) public view returns (uint256, uint256) {
    uint256 epochId = self.currentEpochId();
    uint256 X = self.epochNextSwapX(epochId);
    uint256 k0 = self.epochNextSwapK0(epochId); // scale: 10 ** 10

    uint256 deltaT = 0;
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
      // in current epoch
      deltaT = block.timestamp.sub(epoch.startTime);
    } 
    else {
      // in a new epoch
      deltaT = 0;
    }
    console.log("doCalcSwap, X: %s, k0: %s, deltaT: %s", X, k0, deltaT);

    // X' = X * k0 / (k0 + X * n * (1 + ∆t / 86400)2)

    uint256 decayPeriod = self.paramValue("D").div(30);
    Constants.Terms memory T;
    T.T1 = SCALE.add(
      deltaT.mul(SCALE).div(decayPeriod)
    );  // scale: 18
    console.log("doCalcSwap, T1: %s", T.T1);

    // console.log("doCalSwap, X.mul(n).mul(T.T1): %s", X.mul(n).mul(T.T1));
    // console.log("doCalSwap, X.mul(n).mul(T.T1).mul(T.T1): %s", X.mul(n).mul(T.T1).mul(T.T1));

    // X * n * (1 + ∆t / 86400)2
    T.T2 = X.mul(n).mul(T.T1).div(SCALE).mul(T.T1);   // scale: 18
    console.log("doCalcSwap, T2: %s", T.T2);

    // k0 + X * n * (1 + ∆t / 86400)2
    T.T3 = k0.mul(SCALE).div(10 ** Constants.PROTOCOL_DECIMALS).add(T.T2).div(SCALE);   // scale: 1
    console.log("doCalcSwap, T.T3: %s", T.T3);

    // X' = X * k0 / (k0 + X * n * (1 + ∆t / 86400)2)
    uint256 X_updated = X.mul(k0).div(10 ** Constants.PROTOCOL_DECIMALS).div(T.T3);
    console.log("doCalcSwap, X_updated: %s", X_updated);

    // m = X - X'
    uint256 m = X.sub(X_updated);

    console.log("doCalcSwap, m: %s", m);

    return (X_updated, m);
  }

  function doCalcBribes(IVault self, uint256 epochId, address account) public view returns (Constants.BribeInfo[] memory) {  
    // Constants.Epoch memory epoch = self.epochInfoById(epochId);
    // uint256 epochEndTime = epoch.startTime.add(epoch.duration);
    // require(block.timestamp > epochEndTime, "Epoch not ended yet");

    uint256 yTokenBalanceSynthetic = self.yTokenUserBalanceSynthetic(epochId, account);
    uint256 yTokenTotalSyntheticOfVault = self.yTokenUserBalanceSynthetic(epochId, address(self));
    uint256 yTokenTotalSynthetic = self.yTokenTotalSupplySynthetic(epochId);
    require(yTokenTotalSynthetic >= yTokenBalanceSynthetic + yTokenTotalSyntheticOfVault, "Invalid yToken balance");

    address[] memory epochBribeTokens = self.bribeTokens(epochId);
    Constants.BribeInfo[] memory bribeInfo = new Constants.BribeInfo[](epochBribeTokens.length);
    for (uint256 i = 0; i < epochBribeTokens.length; i++) {
      address bribeToken = epochBribeTokens[i];
      uint256 totalRewards = self.bribeTotalAmount(epochId, bribeToken);
      uint256 bribes = 0;
      if (totalRewards != 0 && yTokenBalanceSynthetic != 0) {
        require(yTokenTotalSynthetic.sub(yTokenTotalSyntheticOfVault) > 0);
        bribes = totalRewards.mul(yTokenBalanceSynthetic).div(yTokenTotalSynthetic.sub(yTokenTotalSyntheticOfVault));
      }
      bribeInfo[i].epochId = epochId;
      bribeInfo[i].bribeToken = bribeToken;
      bribeInfo[i].bribeAmount = bribes;
    }

    return bribeInfo;
  }

}
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

  function calcNextSwapK0(IVault self, uint256 S) public view returns (uint256) {
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");

    uint256 X = S;

    // Y = S * APRi * D / 86400 / 365
    uint256 Y = S.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10
    // k0 = X * Y
    uint256 k0 = X.mul(Y);   // scale: 10 ** 10

    console.log("calcNextSwapK0, S: %s, Y: %s, k0: %s", S, Y, k0);

    return k0;
  }

  function updateNextSwapK0(IVault self, uint256 m) public view returns (uint256) {
    uint256 epochId = self.currentEpochId(); 
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");

    uint256 S = self.yTokenUserBalance(epochId, address(this));
    uint256 X = S;

    console.log("updateNextSwapK0, m: %s, S: %s, X: %s", m, S, X);

    // Y = S * APRi * D / 86400 / 365
    uint256 Y = S.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10
    console.log("updateNextSwapK0, Y: %s", Y);

    // k''(t) = (X + m) * Y * (X + m) / X = (X + m) * (X + m) * Y / X
    uint256 k_t_updated = X.add(m).mul(X.add(m)).mul(Y).div(X);   // scale: 10 ** 10
    console.log("updateNextSwapK0, k_t_updated: %s", k_t_updated);

    // k'0 = k''t * (1 + ∆t / 86400) ^ 2
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
    console.log("updateNextSwapK0, deltaT: %s", deltaT);

    uint256 k0 = k_t_updated.mul(
      SCALE + deltaT.mul(SCALE).div(86400)
    ).div(SCALE).mul(
      SCALE + deltaT.mul(SCALE).div(86400)
    ).div(SCALE);   // scale: 10 ** 10
    console.log("updateNextSwapK0, k0: %s", k0);

    return k0;
  }

  function doCalcSwap(IVault self, uint256 n) public view returns (uint256) {
    uint256 epochId = self.currentEpochId();  // require epochId > 0
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");
    uint256 S = self.yTokenUserBalance(epochId, address(this));
    uint256 X = S;
    console.log("doCalcSwap, X: %s", X);

    // Y = S * APRi * D / 86400 / 365
    uint256 Y = S.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10
    console.log("doCalcSwap, Y: %s", Y);

    uint256 k0 = self.epochNextSwapK0(epochId);
    require(k0 > 0, "Invalid k0");
    console.log("doCalcSwap, k0: %s", k0);

    // kt = 1 * k0 / (1 + ∆t / 86400) ^ 2
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
    console.log("doCalcSwap, deltaT: %s", deltaT);

    uint256 kt = k0.mul(SCALE).div(
      SCALE + deltaT.mul(SCALE).div(86400)
    ).mul(SCALE).div(
      SCALE + deltaT.mul(SCALE).div(86400)
    );   // scale: 10 ** 10
    console.log("doCalcSwap, kt: %s", kt);

    // m = X - kt / (Y + n)
    uint256 m = X.sub(
      kt.div(
        Y.add(n.mul(10 ** Constants.PROTOCOL_DECIMALS))
      )
    );
    console.log("doCalcSwap, m: %s", m);
    return m;
  }

  function doCalcBribes(IVault self, uint256 epochId, address account) public view returns (Constants.BribeInfo[] memory) {  
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    uint256 epochEndTime = epoch.startTime.add(epoch.duration);
    require(block.timestamp > epochEndTime, "Epoch not ended yet");

    uint256 yTokenBalanceSynthetic = self.yTokenUserBalanceSynthetic(epochId, account);
    uint256 yTokenTotalSynthetic = self.yTokenTotalSupplySynthetic(epochId);
    require(yTokenTotalSynthetic >= yTokenBalanceSynthetic, "Invalid yToken balance");

    address[] memory epochBribeTokens = self.bribeTokens(epochId);
    Constants.BribeInfo[] memory bribeInfo = new Constants.BribeInfo[](epochBribeTokens.length);
    for (uint256 i = 0; i < epochBribeTokens.length; i++) {
      address bribeToken = epochBribeTokens[i];
      uint256 totalRewards = self.bribeTotalAmount(epochId, bribeToken);
      uint256 bribes = totalRewards.mul(yTokenBalanceSynthetic).div(yTokenTotalSynthetic);
      bribeInfo[i].epochId = epochId;
      bribeInfo[i].bribeToken = bribeToken;
      bribeInfo[i].bribeAmount = bribes;
    }

    return bribeInfo;
  }

}
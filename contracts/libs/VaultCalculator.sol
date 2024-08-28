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

  function doCalcSwapForYTokens(IVault self, uint256 assetAmount) public view returns (Constants.SwapForYTokensResult memory) {
    uint256 epochId = self.currentEpochId();  // require epochId > 0

    Constants.SwapForYTokensResult memory args;

    bool firstEpochSwap = true;
    uint256 epochLastSwapPriceScaled = 0;
    uint256 epochEndTime = 0;
    args.D = self.paramValue("D");
    console.log("doCalcSwapForYTokens, D: %s", args.D);
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
      // in current epoch
      args.M = self.yTokenTotalSupply(epochId);
      args.S = self.yTokenUserBalance(epochId, address(this));
      args.t0 = epoch.startTime;
      console.log("doCalcSwapForYTokens, current epoch, M: %s, S: %s, t0: %s", args.M, args.S, args.t0);

      if (self.epochLastSwapTimestamp(epochId) > 0) {
        args.deltaT = block.timestamp.sub(self.epochLastSwapTimestamp(epochId));
        firstEpochSwap = false;
        epochLastSwapPriceScaled = self.epochLastSwapPriceScaled(epochId);
      } else {
        args.deltaT = block.timestamp.sub(epoch.startTime);
      }
      epochEndTime = epoch.startTime.add(epoch.duration);
      console.log("doCalcSwapForYTokens, current epoch, deltaT: %s", args.deltaT);
    } 
    else {
      // in a new epoch
      args.M = self.yTokenUserBalance(epochId, address(this));
      args.S = self.yTokenUserBalance(epochId, address(this));
      args.t0 = block.timestamp;
      args.deltaT = 0;
      epochEndTime = block.timestamp.add(args.D);

      console.log("doCalcSwapForYTokens, new epoch, M: %s, S: %s, t0: %s, deltaT: 0", args.M, args.S, args.t0);
    }
    
    args.T = self.paramValue("T");
    args.t = block.timestamp;
    args.e1 = self.paramValue("e1");
    args.e2 = self.paramValue("e2");
    console.log("doCalcSwapForYTokens, T: %s, t: %s", args.T, args.t);
    console.log("doCalcSwapForYTokens, e1: %s, e2: %s", args.e1, args.e2);

    if (firstEpochSwap) {
      // a = APRi * D / 365
      args.APRi = self.paramValue("APRi");
      args.a_scaled = args.APRi.mul(SCALE).mul(args.D).div(365 days);   // scale: 10 ** (10 + 18)
      console.log("doCalcSwapForYTokens, first swap of epoch, args.APRi: %s, a_scaled: %s", args.APRi, args.a_scaled);
    }
    else {
      // a = P / (1 + e1 * (M - S) / M)
      require(epochLastSwapPriceScaled > 0, "Invalid last epoch swap price");
      args.a_scaled = epochLastSwapPriceScaled.mul(SCALE).div(
        (SCALE).add(
          args.e1.mul(args.M.sub(args.S)).mul(SCALE).div(args.M)
        )
      );  // scale: 10 ** (10 + 18)
      console.log("doCalcSwapForYTokens, not first swap of epoch, a_scaled: %s", args.a_scaled);
    }

    // P(L(t)) = APRl * (D - t) / 365
    args.APRl = self.paramValue("APRl");
    args.P_floor_scaled = args.APRl.mul(SCALE).mul(epochEndTime.sub(args.t)).div(365 days);   // scale: 10 ** (10 + 18)
    console.log("doCalcSwapForYTokens, APRl: %s, P_floor_scaled: %s", args.APRl, args.P_floor_scaled);

    /**
     * P(S,t) = a * (
     *    (1 + e1 * (M - S) / M) - deltaT / (
     *      T * (1 + (M - S) / (e2 * M))
     *    )
     * )
     * 
     * P(S,t)_scaled = a * (
     *    (10**10 + e1 * (M - S) * 10**10 / M) - deltaT * 10**10 * 10**10 / (
     *      T * (10**10 + (M - S)*10**10 / (e2 * M))
     *    )
     * ) / (10**10)
     */
    Constants.Terms memory T;
    // (1 + e1 * (M - S) / M)
    T.T1 = args.e1.mul(args.M.sub(args.S)).mul(SCALE).div(args.M);   // scale: 10 ** 18
    // deltaT / (T * (1 + (M - S) / (e2 * M)))
    T.T2 = args.deltaT.mul(SCALE).mul(SCALE).div(
      args.T.mul(
        SCALE.add(
          args.M.sub(args.S).mul(SCALE).div(args.e2.mul(args.M))
        )
      )
    );   // scale: 10 ** 18
    args.P_scaled_positive = T.T1 > T.T2;
    console.log("doCalcSwapForYTokens, T1: %s, T2: %s, P_scaled_positive: %s", T.T1, T.T2, args.P_scaled_positive);
    
    if (args.P_scaled_positive) {
      T.T3 = SCALE.add(T.T1).sub(T.T2);   // scale: 10 ** 18
    } else {
      T.T3 = T.T2.sub(T.T1).sub(SCALE);   // scale: 10 ** 18
    }
    args.P_scaled = args.a_scaled.mul(T.T3).div(SCALE);   // scale: 10 ** (10 + 18)
    console.log("doCalcSwapForYTokens, P_scaled: %s", args.P_scaled);

    bool useFloorPrice = (!args.P_scaled_positive) || (args.P_scaled < args.P_floor_scaled);
    if (useFloorPrice) {
      /**
       * a1 = P_floor / (
       *    (1 + e1 * (M - S) / M) 
       * )
       */
      args.a_scaled = args.P_floor_scaled.mul(SCALE).div(SCALE.add(T.T1));  // scale: 10 ** (10 + 18)
      console.log("doCalcSwapForYTokens, useFloorPrice, a_scaled: %s", args.a_scaled);
    }

    // A = a / M
    args.A = args.a_scaled.mul(10**6).div(args.M);  // scale: 10 ** (10 + 18 + 6)
    console.log("doCalcSwapForYTokens, A: %s", args.A);

    /**
     * B = a * deltaT / (
     *    T * (1 + (M - S) / (e2 * M))
     * ) - a - e1 * a
     */
    args.B = args.a_scaled.mul(args.deltaT).mul(SCALE).mul(10**6).div(
      args.T.mul(
        SCALE.add(
          args.M.sub(args.S).mul(SCALE).div(args.e2.mul(args.M))
        )
      )
    ).sub(args.a_scaled.mul(10**6)).sub(args.e1.mul(args.a_scaled).mul(10**6));   // scale: 10 ** (10 + 18 + 6)
    console.log("doCalcSwapForYTokens, B: %s", args.B);

    // C = X
    args.C = assetAmount.mul(10 ** Constants.PROTOCOL_DECIMALS).mul(SCALE).mul(10**6);    // scale: 10 ** (10 + 18 + 6)
    console.log("doCalcSwapForYTokens, C: %s", args.C);

    /**
     * Y(X) = (B + sqrt(B * B + 4 * A * C)) / (2 * A)
     */
    args.Y = args.B.add(
      Math.sqrt(
        args.B.mul(args.B).add(args.A.mul(4).mul(args.C))
      )
    ).div(args.A.mul(2));
    console.log("doCalcSwapForYTokens, Y: %s", args.Y);

    return args;
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
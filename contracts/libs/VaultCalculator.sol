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

  function doCalcSwapF0(IVault self, uint256 assetAmount) public view returns (Constants.SwapResultF0 memory) {
    uint256 epochId = self.currentEpochId();  // require epochId > 0

    Constants.SwapResultF0 memory result;

    bool firstEpochSwap = true;
    uint256 epochLastSwapPriceScaled = 0;
    uint256 epochEndTime = 0;
    result.D = self.paramValue("D");
    console.log("doCalcSwapF0, D: %s", result.D);
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
      // in current epoch
      result.M = self.yTokenTotalSupply(epochId);
      result.S = self.yTokenUserBalance(epochId, address(this));
      result.t0 = epoch.startTime;
      console.log("doCalcSwapF0, current epoch, M: %s, S: %s, t0: %s", result.M, result.S, result.t0);

      if (self.epochLastSwapTimestampF0(epochId) > 0) {
        result.deltaT = block.timestamp.sub(self.epochLastSwapTimestampF0(epochId));
        firstEpochSwap = false;
        epochLastSwapPriceScaled = self.epochLastSwapPriceScaledF0(epochId);
      } else {
        result.deltaT = block.timestamp.sub(epoch.startTime);
      }
      epochEndTime = epoch.startTime.add(epoch.duration);
      console.log("doCalcSwapF0, current epoch, deltaT: %s", result.deltaT);
    } 
    else {
      // in a new epoch
      result.M = self.yTokenUserBalance(epochId, address(this));
      result.S = self.yTokenUserBalance(epochId, address(this));
      result.t0 = block.timestamp;
      result.deltaT = 0;
      epochEndTime = block.timestamp.add(result.D);

      console.log("doCalcSwapF0, new epoch, M: %s, S: %s, t0: %s, deltaT: 0", result.M, result.S, result.t0);
    }
    
    result.T = self.paramValue("T");
    result.t = block.timestamp;
    result.e1 = self.paramValue("e1");
    result.e2 = self.paramValue("e2");
    console.log("doCalcSwapF0, T: %s, t: %s", result.T, result.t);
    console.log("doCalcSwapF0, e1: %s, e2: %s", result.e1, result.e2);

    if (firstEpochSwap) {
      // a = APRi * D / 365
      result.APRi = self.paramValue("APRi");
      result.a_scaled = result.APRi.mul(SCALE).mul(result.D).div(365 days);   // scale: 10 ** (10 + 18)
      console.log("doCalcSwapF0, first swap of epoch, result.APRi: %s, a_scaled: %s", result.APRi, result.a_scaled);
    }
    else {
      // a = P / (1 + e1 * (M - S) / M)
      require(epochLastSwapPriceScaled > 0, "Invalid last epoch swap price");
      result.a_scaled = epochLastSwapPriceScaled.mul(SCALE).div(
        (SCALE).add(
          result.e1.mul(result.M.sub(result.S)).mul(SCALE).div(result.M)
        )
      );  // scale: 10 ** (10 + 18)
      console.log("doCalcSwapF0, not first swap of epoch, a_scaled: %s", result.a_scaled);
    }

    // P(L(t)) = APRl * (D - t) / 365
    result.APRl = self.paramValue("APRl");
    result.P_floor_scaled = result.APRl.mul(SCALE).mul(epochEndTime.sub(result.t)).div(365 days);   // scale: 10 ** (10 + 18)
    console.log("doCalcSwapF0, APRl: %s, P_floor_scaled: %s", result.APRl, result.P_floor_scaled);

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
    T.T1 = result.e1.mul(result.M.sub(result.S)).mul(SCALE).div(result.M);   // scale: 10 ** 18
    // deltaT / (T * (1 + (M - S) / (e2 * M)))
    T.T2 = result.deltaT.mul(SCALE).mul(SCALE).div(
      result.T.mul(
        SCALE.add(
          result.M.sub(result.S).mul(SCALE).div(result.e2.mul(result.M))
        )
      )
    );   // scale: 10 ** 18
    result.P_scaled_positive = T.T1 > T.T2;
    console.log("doCalcSwapF0, T1: %s, T2: %s, P_scaled_positive: %s", T.T1, T.T2, result.P_scaled_positive);
    
    if (result.P_scaled_positive) {
      T.T3 = SCALE.add(T.T1).sub(T.T2);   // scale: 10 ** 18
    } else {
      T.T3 = T.T2.sub(T.T1).sub(SCALE);   // scale: 10 ** 18
    }
    result.P_scaled = result.a_scaled.mul(T.T3).div(SCALE);   // scale: 10 ** (10 + 18)
    console.log("doCalcSwapF0, P_scaled: %s", result.P_scaled);

    bool useFloorPrice = (!result.P_scaled_positive) || (result.P_scaled < result.P_floor_scaled);
    if (useFloorPrice) {
      /**
       * a1 = P_floor / (
       *    (1 + e1 * (M - S) / M) 
       * )
       */
      result.a_scaled = result.P_floor_scaled.mul(SCALE).div(SCALE.add(T.T1));  // scale: 10 ** (10 + 18)
      console.log("doCalcSwapF0, useFloorPrice, a_scaled: %s", result.a_scaled);
    }

    // A = a / M
    result.A = result.a_scaled.mul(10**6).div(result.M);  // scale: 10 ** (10 + 18 + 6)
    console.log("doCalcSwapF0, A: %s", result.A);

    /**
     * B = a * deltaT / (
     *    T * (1 + (M - S) / (e2 * M))
     * ) - a - e1 * a
     */
    result.B = result.a_scaled.mul(result.deltaT).mul(SCALE).mul(10**6).div(
      result.T.mul(
        SCALE.add(
          result.M.sub(result.S).mul(SCALE).div(result.e2.mul(result.M))
        )
      )
    ).sub(result.a_scaled.mul(10**6)).sub(result.e1.mul(result.a_scaled).mul(10**6));   // scale: 10 ** (10 + 18 + 6)
    console.log("doCalcSwapF0, B: %s", result.B);


    // C = X
    result.X = assetAmount;
    result.C = assetAmount.mul(10 ** Constants.PROTOCOL_DECIMALS).mul(SCALE).mul(10**6);    // scale: 10 ** (10 + 18 + 6)
    console.log("doCalcSwapF0, C: %s", result.C);

    /**
     * Y(X) = (B + sqrt(B * B + 4 * A * C)) / (2 * A)
     */
    result.Y = result.B.add(
      Math.sqrt(
        result.B.mul(result.B).add(result.A.mul(4).mul(result.C))
      )
    ).div(result.A.mul(2));
    console.log("doCalcSwapF0, Y: %s", result.Y);

    return result;
  }

  function calcSwapK0(IVault self) public view returns (uint256) {
    uint256 epochId = self.currentEpochId(); 
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");

    uint256 S = self.yTokenUserBalance(epochId, address(this));
    uint256 X = S;

    // Y = S * APRi * D / 86400 / 365
    uint256 Y = S.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10
    // k0 = X * Y
    uint256 k0 = X.mul(Y);   // scale: 10 ** 10

    return k0;
  }

  function calcSwapKt(IVault self, uint256 m) public view returns (uint256) {
    uint256 epochId = self.currentEpochId(); 
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");

    uint256 S = self.yTokenUserBalance(epochId, address(this));
    uint256 X = S;

    // Y = S * APRi * D / 86400 / 365
    uint256 Y = S.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10

    // k'(t) = (X + m) * Y * (X + m) / X = (X + m) * (X + m) * Y / X
    uint256 k_t = X.add(m).mul(X.add(m)).mul(Y).div(X);   // scale: 10 ** 10

    // uint256 deltaT = 0;
    // Constants.Epoch memory epoch = self.epochInfoById(epochId);
    // if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
    //   // in current epoch
    //   if (self.epochLastSwapTimestampF1(epochId) > 0) {
    //     deltaT = block.timestamp.sub(self.epochLastSwapTimestampF1(epochId));
    //   } 
    //   else {
    //     deltaT = block.timestamp.sub(epoch.startTime);
    //   }
    // } 
    // else {
    //   // in a new epoch
    //   deltaT = 0;
    // }

    // // k' = K'(t) * (1 + deltaT / 86400)^2
    // uint256 k = k_t.mul(
    //   SCALE + deltaT.mul(SCALE).div(86400)
    // ).mul(
    //   SCALE + deltaT.mul(SCALE).div(86400)
    // ).div(SCALE);   // scale: 10 ** 10

    return k_t;
  }

  function doCalcSwapF1(IVault self, uint256 n) public view returns (uint256) {
    uint256 epochId = self.currentEpochId();  // require epochId > 0
    uint256 D = self.paramValue("D");
    uint256 APRi = self.paramValue("APRi");
    uint256 S = self.yTokenUserBalance(epochId, address(this));
    uint256 X = S;

    // Y = S * APRi * D / 86400 / 365
    uint256 Y = S.mul(APRi).mul(D).div(86400).div(365);   // scale: 10 ** 10
    // k0 = X * Y
    uint256 k0 = X.mul(Y);   // scale: 10 ** 10

    uint256 deltaT = 0;
    uint256 kt = k0;
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
      // in current epoch
      if (self.epochLastSwapTimestampF1(epochId) > 0) {
        deltaT = block.timestamp.sub(self.epochLastSwapTimestampF1(epochId));
      } 
      else {
        deltaT = block.timestamp.sub(epoch.startTime);
      }
      if (self.epochLastMintKtF1(epochId) > 0) {
        kt = self.epochLastMintKtF1(epochId);
      } 
    } 
    else {
      // in a new epoch
      deltaT = 0;
    }

    // k' = K'(t) * (1 + deltaT / 86400)^2
    uint256 k = kt.mul(
      SCALE + deltaT.mul(SCALE).div(86400)
    ).mul(
      SCALE + deltaT.mul(SCALE).div(86400)
    ).div(SCALE);   // scale: 10 ** 10

    // m = X - k / (Y + n)
    uint256 m = X.sub(
      k.div(Y.add(n)).div(10 ** Constants.PROTOCOL_DECIMALS)
    );
    return m;
  }

  // function doCalcSwapF1(IVault self, uint256 assetAmount) public view returns (Constants.SwapResultF1 memory) {
  //   uint256 epochId = self.currentEpochId();  // require epochId > 0

  //   Constants.SwapResultF1 memory result;

  //   bool firstEpochSwap = true;
  //   result.D = self.paramValue("D");
  //   result.APRi = self.paramValue("APRi");
  //   Constants.Epoch memory epoch = self.epochInfoById(epochId);

  //   result.S = self.yTokenUserBalance(epochId, address(this));
  //   result.X = result.S;
  //   if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
  //     // in current epoch
  //     result.t0 = epoch.startTime;

  //     if (self.epochLastSwapTimestampF1(epochId) > 0) {
  //       result.deltaT = block.timestamp.sub(self.epochLastSwapTimestampF1(epochId));
  //       firstEpochSwap = false;
  //     } else {
  //       result.deltaT = block.timestamp.sub(epoch.startTime);
  //     }
  //   } 
  //   else {
  //     // in a new epoch
  //     result.t0 = block.timestamp;
  //     result.deltaT = 0;
  //   }
    
  //   result.t = block.timestamp;


  //   if (firstEpochSwap) {
  //     // Y = S * APRi * D / 86400 / 365
  //     result.Y = result.S.mul(result.APRi).mul(result.D).div(86400).div(365);   // scale: 10 ** 10
  //     // k0 = X * Y
  //     result.k0 = result.X.mul(result.Y);   // scale: 10 ** 10
  //     result.n = assetAmount;
  //     // m = X - k0 / (Y + n)
  //     result.m = result.X.sub(
  //       result.k0.div(result.Y.add(result.n.mul(10 ** Constants.PROTOCOL_DECIMALS)))
  //     );
  //   }
  //   else {

  //   }

  //   return result;
  // }

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
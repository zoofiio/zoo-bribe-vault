// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./Constants.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IVault.sol";

library VaultCalculator {
  using SafeMath for uint256;

  function doCalcSwapForYTokens(IVault self, uint256 assetAmount) public view returns (Constants.SwapForYTokensArgs memory) {
    uint256 epochId = self.currentEpochId();
    require(epochId > 0, "No epochs yet");

    Constants.SwapForYTokensArgs memory args;

    bool firstEpochSwap = true;
    uint256 epochLastSwapPrice = 0;
    uint256 epochEndTime = 0;
    args.D = self.paramValue("D");
    Constants.Epoch memory epoch = self.epochInfoById(epochId);
    if (epoch.startTime.add(epoch.duration) >= block.timestamp) {
      // in current epoch
      args.M = self.yTokenTotalSupply(epochId);
      args.S = self.yTokenUserBalance(epochId, address(this));
      args.t0 = epoch.startTime;

      if (self.epochLastSwapTimestamp(epochId) > 0) {
        args.deltaT = block.timestamp.sub(self.epochLastSwapTimestamp(epochId));
        firstEpochSwap = false;
        epochLastSwapPrice = self.epochLastSwapPrice(epochId);
      } else {
        args.deltaT = block.timestamp.sub(epoch.startTime);
      }
      epochEndTime = epoch.startTime.add(epoch.duration);
    } 
    else {
      // in a new epoch
      args.M = self.yTokenUserBalance(epochId, address(this));
      args.S = self.yTokenUserBalance(epochId, address(this));
      args.t0 = block.timestamp;
      args.deltaT = 0;
      epochEndTime = block.timestamp.add(args.D);
    }
    
    args.T = self.paramValue("T");
    args.t = block.timestamp;
    args.e1 = self.paramValue("e1");
    args.e2 = self.paramValue("e2");

    if (firstEpochSwap) {
      // a = APRi * D / 365
      uint256 APRi = self.paramValue("APRi");
      args.a_scaled = APRi.mul(args.D).div(365 days);
    }
    else {
      // a = P / (1 + e1 * (M - S) / M)
      require(epochLastSwapPrice > 0, "Invalid last epoch swap price");
      args.a_scaled = epochLastSwapPrice.mul(Constants.SCALE_FACTOR).mul(Constants.SCALE_FACTOR).div(
        (Constants.SCALE_FACTOR).add(
          args.e1.mul(args.M.sub(args.S)).mul(Constants.SCALE_FACTOR).div(args.M)
        )
      );
    }

    // P(L(t)) = APRl * (D - t) / 365
    uint256 APRl = self.paramValue("APRl");
    args.P_floor_scaled = APRl.mul(epochEndTime.sub(args.t)).div(365 days);

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
    uint256 dominator_scaled = Constants.SCALE_FACTOR.add(
        args.e1.mul(args.M.sub(args.S)).mul(Constants.SCALE_FACTOR).div(args.M)
      ).sub(
        args.deltaT.mul(Constants.SCALE_FACTOR).mul(Constants.SCALE_FACTOR).div(
          args.T.mul(
            Constants.SCALE_FACTOR.add(
              args.M.sub(args.S).mul(Constants.SCALE_FACTOR).div(args.e2.mul(args.M))
            )
          )
        )
      );
    args.P_scaled = args.a_scaled.mul(
      dominator_scaled
    ).div(Constants.SCALE_FACTOR);

    bool useFloorPrice = args.P_scaled < args.P_floor_scaled;
    if (useFloorPrice) {
      /**
       * a1 = P_floor / (
       *    (1 + e1 * (M - S) / M) - deltaT / (
       *        T * (1 + (M - S) / (e2 * M))
       *    )
       * )
       */
      args.a_scaled = args.P_floor_scaled.mul(Constants.SCALE_FACTOR).div(dominator_scaled);
    }

    // A = a / M
    args.A = args.a_scaled.div(args.M);

    /**
     * B = a * deltaT / (
     *    T * (1 + (M - S) / (e2 * M))
     * ) - a - e1 * a
     */
    args.B = args.a_scaled.mul(args.deltaT).mul(Constants.SCALE_FACTOR).div(
      args.T.mul(
        Constants.SCALE_FACTOR.add(
          args.M.sub(args.S).mul(Constants.SCALE_FACTOR).div(args.e2.mul(args.M))
        )
      )
    ).sub(args.a_scaled).sub(args.e1.mul(args.a_scaled));

    // C = X
    args.C = assetAmount;

    /**
     * Y(X) = B + sqrt(B * B + 4 * A * C) / (2 * A)
     */
    args.Y = args.B.add(
      Math.sqrt(
        args.B.mul(args.B).add(args.A.mul(4).mul(args.C))
      )
    ).div(args.A.mul(2));

    return args;
  }

}
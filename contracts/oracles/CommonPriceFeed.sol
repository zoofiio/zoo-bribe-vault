// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "../interfaces/IPriceFeed.sol";

contract CommonPriceFeed is IPriceFeed {
  using SafeCast for int256;

  AggregatorV3Interface public immutable chainlinkPriceFeed;

  constructor(address _chainlinkPriceFeed) {
    chainlinkPriceFeed = AggregatorV3Interface(_chainlinkPriceFeed);
  }

  function decimals() external view override returns (uint8) {
    return chainlinkPriceFeed.decimals();
  }

  function latestPrice() external view override returns (uint256) {
    (, int256 answer, , uint256 updatedAt,) = chainlinkPriceFeed.latestRoundData();
    /*
      https://docs.redstone.finance/docs/smart-contract-devs/price-feeds
      https://docs.chain.link/data-feeds/api-reference#latestrounddata
      answeredInRound: The round ID in which the answer was computed (Deprecated - Previously used when answers could take multiple rounds to be computed)
      updatedAt: Timestamp of when the round was updated
      answer: The answer for this round
    */
    // require(answeredInRound >= roundId, "answer is stale");
    require(updatedAt > 0, "round is incomplete");
    require(answer > 0, "Invalid feed answer");
    return answer.toUint256();
  }
}
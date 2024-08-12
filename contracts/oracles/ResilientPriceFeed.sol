// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../interfaces/IPriceFeed.sol";
import "../interfaces/OracleInterface.sol";
import "../libs/Constants.sol";

contract ResilientPriceFeed is IPriceFeed {

  address public immutable asset;
  OracleInterface public immutable resilientOracle;

  constructor(address _asset, address _resilientOracle) {
    asset = _asset;
    resilientOracle = OracleInterface(_resilientOracle);
  }

  function decimals() external pure override returns (uint8) {
    return 18;
  }

  function latestPrice() external view override returns (uint256) {
    return resilientOracle.getPrice(asset);
  }
}
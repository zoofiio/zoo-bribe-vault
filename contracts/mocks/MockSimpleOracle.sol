// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../interfaces/OracleInterface.sol";

/**
 * @dev Updated from https://github.com/VenusProtocol/oracle/blob/develop/contracts/test/MockSimpleOracle.sol
 */
contract MockSimpleOracle is OracleInterface {
  mapping(address => uint256) public prices;

  constructor() {
    //
  }

  function getPrice(address asset) external view returns (uint256) {
    return prices[asset];
  }

  function setPrice(address asset, uint256 price) public {
    prices[asset] = price;
  }
}
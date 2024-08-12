// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

/**
 * @dev Updated from https://github.com/VenusProtocol/oracle/blob/develop/contracts/interfaces/OracleInterface.sol
 */
interface OracleInterface {
  function getPrice(address asset) external view returns (uint256);
}

interface BoundValidatorInterface {
  function validatePriceWithAnchorPrice(
    address asset,
    uint256 reporterPrice,
    uint256 anchorPrice
  ) external view returns (bool);
}
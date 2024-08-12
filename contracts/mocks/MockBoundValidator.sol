// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../interfaces/OracleInterface.sol";

/**
 * @dev Updated from https://github.com/VenusProtocol/oracle/blob/develop/contracts/test/MockSimpleOracle.sol::MockBoundValidator
 */
contract MockBoundValidator is BoundValidatorInterface {
  mapping(address => bool) public validateResults;

  constructor() {}

  function validatePriceWithAnchorPrice(
    address asset,
    uint256 reporterPrice,
    uint256 anchorPrice
  ) external view returns (bool) {
    return validateResults[asset];
  }

  function setValidateResult(address token, bool pass) public {
      validateResults[token] = pass;
  }
}
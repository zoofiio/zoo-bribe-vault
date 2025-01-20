// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IYeetTrifectaVault is IERC4626 {

  /**
   * @notice Constant for basis point calculations
   * @return The scale factor for basis points (10000)
   */
  function _BASIS_POINT_SCALE() external view returns (uint256);

  /**
   * @notice Maximum allowed fee in basis points
   * @return The maximum fee that can be set, in basis points
   */
  function maxAllowedFeeBps() external view returns (uint256);

}

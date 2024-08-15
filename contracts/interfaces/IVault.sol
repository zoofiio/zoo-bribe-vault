// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../libs/Constants.sol";

interface IVault {

  function assetToken() external view returns (address);

  function assetBalance() external view returns (uint256);

  function pToken() external view returns (address);

  function paramValue(bytes32 param) external view returns (uint256);

}
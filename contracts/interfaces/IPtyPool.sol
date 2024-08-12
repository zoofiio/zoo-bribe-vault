// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IPtyPool {

  function vault() external view returns (address);

  function totalStakingShares() external view returns (uint256);

  function totalStakingBalance() external view returns (uint256);

  function addStakingYields(uint256 yieldsAmount) external;

  function addMatchingYields(uint256 yieldsAmount) external;

}
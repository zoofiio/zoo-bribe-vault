// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IBribesPool {

  function totalSupply() external view returns (uint256);

  function addBribes(address bribeToken, uint256 bribesAmount) external;

  function notifyYTSwappedForUser(address user, uint256 deltaYTAmount) external;

  function updateEpochEndTimeOnVaultClose(uint256 newEpochEndTimestamp) external;

}
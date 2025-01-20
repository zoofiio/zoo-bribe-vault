// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../libs/Constants.sol";

interface IStakingPool {

  function rewardTokens(uint256 index) external view returns (address);

  function balanceOf(address account) external view returns (uint256);

  function stake(uint256 amount) external;

  function getReward() external;

  function withdraw(uint256 amount) external;

  function exit() external;
}
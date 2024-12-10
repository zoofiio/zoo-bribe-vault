// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IBribesPoolFactory {

  function createStakingBribesPool(address _vault) external returns (address);

  function createAdhocBribesPool(address _vault, uint256 _epochEndTimestamp) external returns (address);

}
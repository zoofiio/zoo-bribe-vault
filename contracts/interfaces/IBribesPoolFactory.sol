// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IBribesPoolFactory {

  function createAutoBribesPool(address _vault) external returns (address);

  function createManualBribesPool(address _vault) external returns (address);

}
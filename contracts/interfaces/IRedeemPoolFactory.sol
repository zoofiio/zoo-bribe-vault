// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IRedeemPoolFactory {

  function createRedeemPool(address _vault) external returns (address);

}
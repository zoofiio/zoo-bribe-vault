// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IInfrared {
  function vaultRegistry(address lp) external view returns (address);
}
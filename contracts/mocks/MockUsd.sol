// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../tokens/Usd.sol";

contract MockUsd is Usd {
  constructor(address _protocol, address _settings) Usd(_protocol, _settings) {}

  modifier onlyVault() override {
    // _checkOwner();
    _;
  }
}
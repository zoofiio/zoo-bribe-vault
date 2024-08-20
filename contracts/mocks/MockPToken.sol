// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../tokens/PToken.sol";

contract MockPToken is PToken {
  constructor(address _protocol, address _settings) PToken(_protocol, _settings, "Mock pToken", "pTK") {}

  modifier onlyVault() override {
    // _checkOwner();
    _;
  }
}
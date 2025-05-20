// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "../tokens/PTokenV2.sol";

contract MockPTokenV2 is PTokenV2 {
  constructor(address _protocol, address _settings) PTokenV2(_protocol, _settings, "Mock pTokenV2", "pTK2", 18) {}

  modifier onlyVault() override {
    // _checkOwner();
    _;
  }
}
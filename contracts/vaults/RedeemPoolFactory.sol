// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../interfaces/IZooProtocol.sol";
import "./RedeemPool.sol";
import "../settings/ProtocolOwner.sol";

contract RedeemPoolFactory is ReentrancyGuard, ProtocolOwner {

  constructor(
    address _protocol
  ) ProtocolOwner(_protocol) { }

  function createRedeemPool(
    address _vault
  ) external nonReentrant onlyVault returns (address) {
    return address(new RedeemPool(_vault));
  }

  modifier onlyVault() virtual {
    require (IZooProtocol(protocol).isVault(_msgSender()), "Caller is not a Vault contract");
    _;
  }

}
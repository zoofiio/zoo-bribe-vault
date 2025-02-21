// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IRedeemPoolFactory.sol";
import "../interfaces/IZooProtocol.sol";
import "./RedeemPool.sol";
import "../settings/ProtocolOwner.sol";

contract RedeemPoolFactory is IRedeemPoolFactory, ReentrancyGuard, ProtocolOwner {

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
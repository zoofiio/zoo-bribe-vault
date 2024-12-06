// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./AutoBribesPool.sol";
import "./ManualBribesPool.sol";
import "../interfaces/IBribesPoolFactory.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";

contract BribesPoolFactory is IBribesPoolFactory, ReentrancyGuard, ProtocolOwner {

  constructor(
    address _protocol
  ) ProtocolOwner(_protocol) { }

  function createAutoBribesPool(
    address _vault
  ) external nonReentrant onlyVault returns (address) {
    return address(new AutoBribesPool(_vault));
  }

  function createManualBribesPool(
    address _vault
  ) external nonReentrant onlyVault returns (address) {
    return address(new ManualBribesPool(_vault));
  }

  modifier onlyVault() virtual {
    require (IZooProtocol(protocol).isVault(_msgSender()), "Caller is not a Vault contract");
    _;
  }

}
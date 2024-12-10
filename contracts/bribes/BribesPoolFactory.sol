// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./StakingBribesPool.sol";
import "./AdhocBribesPool.sol";
import "../interfaces/IBribesPoolFactory.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";

contract BribesPoolFactory is IBribesPoolFactory, ReentrancyGuard, ProtocolOwner {

  constructor(
    address _protocol
  ) ProtocolOwner(_protocol) { }

  function createStakingBribesPool(
    address _vault
  ) external nonReentrant onlyVault returns (address) {
    return address(new StakingBribesPool(_vault));
  }

  function createAdhocBribesPool(
    address _vault, uint256 _epochEndTimestamp
  ) external nonReentrant onlyVault returns (address) {
    return address(new AdhocBribesPool(_vault, _epochEndTimestamp));
  }

  modifier onlyVault() virtual {
    require (IZooProtocol(protocol).isVault(_msgSender()), "Caller is not a Vault contract");
    _;
  }

}
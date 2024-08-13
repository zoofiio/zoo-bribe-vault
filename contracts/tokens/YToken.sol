// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract YToken is ERC20, ReentrancyGuard {
  address public immutable vaultOwner;

  constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
    vaultOwner = msg.sender;
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function mint(address to, uint256 amount) external nonReentrant onlyVault {
    _mint(to, amount);
  }

  function burn(address account, uint256 amount) external nonReentrant onlyVault {
    _burn(account, amount);
  }

  /* ============== MODIFIERS =============== */

  modifier onlyVault() {
    require(vaultOwner == _msgSender(), "Caller is not Vault");
    _;
  }
}
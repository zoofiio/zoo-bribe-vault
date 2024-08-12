// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract MockERC20 is ERC20, ERC20Burnable, Ownable, ReentrancyGuard {
  using EnumerableSet for EnumerableSet.AddressSet;

  EnumerableSet.AddressSet internal _admins;
  uint8 internal _decimals;

  constructor(
    string memory name,
    string memory symbol
  ) Ownable() ERC20(name, symbol) {
    _setAdmin(_msgSender(), true);
    _decimals = 18;
  }

  /* ================= VIEWS ================ */

  function decimals() public view virtual override returns (uint8) {
    return _decimals;
  }

  function getAdminsCount() public view returns (uint256) {
    return _admins.length();
  }

  function getAdmin(uint256 index) public view returns (address) {
    require(index < _admins.length(), "Invalid index");
    return _admins.at(index);
  }

  function isAdmin(address account) public view returns (bool) {
    return _admins.contains(account);
  }

  /* ================= MUTATIVE FUNCTIONS ================ */

  function setDecimals(uint8 decimals_) external nonReentrant onlyOwner {
    _decimals = decimals_;
  }

  function setAdmin(address account, bool minter) external nonReentrant onlyOwner {
    _setAdmin(account, minter);
  }

  function mint(address to, uint256 value) public virtual nonReentrant onlyAdmin returns (bool) {
    _mint(to, value);
    return true;
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _setAdmin(address account, bool admin) internal {
    require(account != address(0), "Zero address detected");

    if (admin) {
      require(!_admins.contains(account), "Address is already admin");
      _admins.add(account);
    }
    else {
      require(_admins.contains(account), "Address was not admin");
      _admins.remove(account);
    }

    emit UpdateAdmin(account, admin);
  }

  /* ============== MODIFIERS =============== */

  modifier onlyAdmin() {
    require(isAdmin(_msgSender()), "Caller is not admin");
    _;
  }

  /* ========== EVENTS ========== */

  event UpdateAdmin(address indexed account, bool admin);
}
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../interfaces/IProtocolSettings.sol";
import "../settings/ProtocolOwner.sol";

contract MarginToken is ProtocolOwner, ERC20, ReentrancyGuard {
  using SafeMath for uint256;

  IProtocolSettings public immutable settings;

  address public vault;

  string internal _name_;
  string internal _symbol_;

  constructor(address _protocol, address _settings, string memory _name, string memory _symbol) ProtocolOwner(_protocol) ERC20(_name, _symbol) {
    settings = IProtocolSettings(_settings);
    _name_ = _name;
    _symbol_ = _symbol;
  }

  /* ================= IERC20 Functions ================ */

  function name() public view virtual override returns (string memory) {
    return _name_;
  }

  function symbol() public view virtual override returns (string memory) {
    return _symbol_;
  }

  function transfer(address to, uint256 amount) public override nonReentrant returns (bool) {
    return super.transfer(to, amount);
  }

  function transferFrom(address from, address to, uint256 amount) public override nonReentrant returns (bool) {
    return super.transferFrom(from, to, amount);
  }

  function approve(address spender, uint256 amount) public override nonReentrant returns (bool) {
    return super.approve(spender, amount);
  }

  function increaseAllowance(address spender, uint256 addedValue) public override nonReentrant returns (bool) {
    return super.increaseAllowance(spender, addedValue);
  }

  function decreaseAllowance(address spender, uint256 subtractedValue) public override nonReentrant returns (bool) {
    return super.decreaseAllowance(spender, subtractedValue);
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function setName(string memory _name) external nonReentrant onlyOwner {
    _name_ = _name;
  }

  function setSymbol(string memory _symbol) external nonReentrant onlyOwner {
    _symbol_ = _symbol;
  }

  function mint(address to, uint256 amount) public nonReentrant onlyVault {
    _mint(to, amount);
  }

  function burn(address account, uint256 amount) public nonReentrant onlyVault {
    _burn(account, amount);
  }

  function setVault(address _vault) external nonReentrant onlyOwner {
    require(vault == address(0), "Vault already set");
    require(_vault != address(0), "Zero address detected");

    vault = _vault;
    emit SetVault(vault);
  }

  /* ============== MODIFIERS =============== */

  modifier onlyVault() {
    require(vault != address(0), "Vault not set");
    require(vault == _msgSender(), "Caller is not Vault");
    _;
  }

  /* =============== EVENTS ============= */

  event SetVault(address indexed vault);
}
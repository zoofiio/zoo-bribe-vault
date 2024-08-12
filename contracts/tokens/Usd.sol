// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IUsd.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";

contract Usd is IUsd, ProtocolOwner, ReentrancyGuard {
  using SafeMath for uint256;

  uint256 constant internal INFINITE_ALLOWANCE = type(uint256).max;

  IProtocolSettings public immutable settings;

  uint256 private _totalSupply;

  uint256 private _totalShares;
  mapping(address => uint256) private _shares;

  mapping (address => mapping (address => uint256)) private _allowances;

  constructor(address _protocol, address _settings) ProtocolOwner(_protocol) {
    require(_protocol != address(0) && _settings != address(0), "Zero address detected");

    settings = IProtocolSettings(_settings);
  }

  /* ================= IERC20Metadata ================ */

  function name() public pure returns (string memory) {
    return 'Zoo USD';
  }

  function symbol() public pure returns (string memory) {
    return 'zUSD';
  }

  function decimals() public pure returns (uint8) {
    return 18;
  }

  /* ================= IERC20 Views ================ */

  function totalSupply() public view returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address account) public view returns (uint256) {
    return getBalanceByShares(_shares[account]);
  }

  function allowance(address owner, address spender) public view returns (uint256) {
    return _allowances[owner][spender];
  }

  /* ================= Views ================ */

  function totalShares() public view returns (uint256) {
    return _totalShares;
  }

  function sharesOf(address account) public view returns (uint256) {
    return _shares[account];
  }

  function getSharesByBalance(uint256 balance) public view returns (uint256) {
    // Initial mint
    if (_totalSupply == 0 || _totalShares == 0) return balance;

    return balance
      .mul(_totalShares)
      .div(_totalSupply);
  }

  function getBalanceByShares(uint256 sharesAmount) public view override returns (uint256) {
    if (_totalShares == 0) return 0;
  
    return sharesAmount
      .mul(_totalSupply)
      .div(_totalShares);
  }

  /* ================= IERC20 Functions ================ */

  function transfer(address to, uint256 amount) external nonReentrant returns (bool) {
    _transfer(_msgSender(), to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external nonReentrant returns (bool) {
    _spendAllowance(from, _msgSender(), amount);
    _transfer(from, to, amount);
    return true;
  }

  function approve(address spender, uint256 amount) external nonReentrant returns (bool) {
    _approve(_msgSender(), spender, amount);
    return true;
  }

  function increaseAllowance(address spender, uint256 addedValue) external nonReentrant returns (bool) {
    _approve(_msgSender(), spender, _allowances[_msgSender()][spender].add(addedValue));
    return true;
  }

  function decreaseAllowance(address spender, uint256 subtractedValue) external nonReentrant returns (bool) {
    uint256 currentAllowance = _allowances[_msgSender()][spender];
    require(currentAllowance >= subtractedValue, "Allowance below zero");
    _approve(_msgSender(), spender, currentAllowance.sub(subtractedValue));
    return true;
  }

  /* ================= IUsd Functions ================ */

  function mint(address to, uint256 amount) external nonReentrant onlyVault returns (uint256) {
    require(to != address(0), "Zero address detected");
    require(amount > 0, 'Amount too small');

    uint256 sharesAmount = getSharesByBalance(amount);
    _mintShares(to, sharesAmount);
    _totalSupply = _totalSupply.add(amount);

    _emitTransferEvents(address(0), to, amount, sharesAmount);

    return sharesAmount;
  }

  function rebase(uint256 addedSupply) external nonReentrant onlyVault {
    require(addedSupply > 0, 'Amount too small');
    _totalSupply = _totalSupply.add(addedSupply);
    emit Rebased(addedSupply);
  }

  function burn(address account, uint256 amount) external nonReentrant onlyVault returns (uint256) {
    require(account != address(0), "Zero address detected");
    require(amount > 0, 'Amount too small');

    uint256 sharesAmount = getSharesByBalance(amount);
    _burnShares(account, sharesAmount);
    _totalSupply = _totalSupply.sub(amount);

    _emitTransferEvents(account, address(0), amount, sharesAmount);

    return sharesAmount;
  }

  function transferShares(address to, uint256 sharesAmount) external nonReentrant returns (uint256) {
    _transferShares(_msgSender(), to, sharesAmount);
    uint256 tokensAmount = getBalanceByShares(sharesAmount);
    _emitTransferEvents(_msgSender(), to, tokensAmount, sharesAmount);
    return tokensAmount;
  }

  function transferSharesFrom(address sender, address to, uint256 sharesAmount) external nonReentrant returns (uint256) {
    uint256 tokensAmount = getBalanceByShares(sharesAmount);
    _spendAllowance(sender, _msgSender(), tokensAmount);
    _transferShares(sender, to, sharesAmount);
    _emitTransferEvents(sender, to, tokensAmount, sharesAmount);
    return tokensAmount;
  }

  /* ================= INTERNAL Functions ================ */

  function _transfer(address sender, address to, uint256 amount) internal {
    uint256 _sharesToTransfer = getSharesByBalance(amount);
    _transferShares(sender, to, _sharesToTransfer);
    _emitTransferEvents(sender, to, amount, _sharesToTransfer);
  }

  function _approve(address owner, address spender, uint256 amount) internal {
    require(owner != address(0), "Approve from zero address");
    require(spender != address(0), "Approve to zero address");

    _allowances[owner][spender] = amount;
    emit Approval(owner, spender, amount);
  }

  function _spendAllowance(address owner, address spender, uint256 amount) internal {
    uint256 currentAllowance = _allowances[owner][spender];
    if (currentAllowance != INFINITE_ALLOWANCE) {
      require(currentAllowance >= amount, "Allowance exceeded");
      _approve(owner, spender, currentAllowance - amount);
    }
  }

  function _transferShares(address from, address to, uint256 sharesAmount) internal {
    require(from != address(0), "Transfer from zero address");
    require(to != address(0), "Transfer to zero address");
    require(to != address(this), "Transfer to this contract");

    uint256 currentSenderShares = _shares[from];
    require(sharesAmount <= currentSenderShares, "Balance exceeded");

    _shares[from] = currentSenderShares.sub(sharesAmount);
    _shares[to] = _shares[to].add(sharesAmount);
  }

  function _mintShares(address to, uint256 sharesAmount) internal returns (uint256 newTotalShares) {
    require(to != address(0), "Mint to zero address");

    _totalShares = _totalShares.add(sharesAmount);
    _shares[to] = _shares[to].add(sharesAmount);

    return _totalShares;
  }

  function _burnShares(address account, uint256 sharesAmount) internal returns (uint256 newTotalShares) {
    require(account != address(0), "Burn from zero address");

    require(sharesAmount <= _shares[account], "Balance exceeded");

    _totalShares = _totalShares.sub(sharesAmount);
    _shares[account] = _shares[account].sub(sharesAmount);

    return _totalShares;
  }

  function _emitTransferEvents(address from, address to, uint256 tokenAmount, uint256 sharesAmount) internal {
    emit Transfer(from, to, tokenAmount);
    emit TransferShares(from, to, sharesAmount);
  }

  modifier onlyVault() virtual {
    require (IZooProtocol(protocol).isVault(_msgSender()), "Caller is not a Vault contract");
    _;
  }

  /* ================= Events ================ */

  event TransferShares(address indexed from, address indexed to, uint256 sharesValue);
  event Rebased(uint256 addedSupply);
}
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IPTokenV2.sol";
import "../settings/ProtocolOwner.sol";

contract PTokenV2 is IPTokenV2, ProtocolOwner, ReentrancyGuard {
  using Math for uint256;

  uint256 constant internal INFINITE_ALLOWANCE = type(uint256).max;

  IProtocolSettings public immutable settings;
  address public immutable vault;

  string internal _name_;
  string internal _symbol_;
  uint8 internal immutable _decimals_;

  uint256 private _totalSupply;

  uint256 private _totalShares;
  mapping(address => uint256) private _shares;

  mapping (address => mapping (address => uint256)) private _allowances;

  uint256 public rebaseRate;
  uint256 public rebaseFinish;
  uint256 public lastRebaseSettleTime;
  uint256 constant public RebaseRateScale = 1e36;  

  constructor(address _protocol, address _settings, string memory _name, string memory _symbol, uint8 _decimals) ProtocolOwner(_protocol) {
    require(_protocol != address(0) && _settings != address(0), "Zero address detected");

    settings = IProtocolSettings(_settings);
    vault = _msgSender();
    _name_ = _name;
    _symbol_ = _symbol;
    _decimals_ = _decimals;
  }

  /* ================= IERC20Metadata ================ */

  function name() public view virtual returns (string memory) {
    return _name_;
  }

  function symbol() public view virtual returns (string memory) {
    return _symbol_;
  }

  function decimals() public view returns (uint8) {
    return _decimals_;
  }

  function decimalsOffset() public view virtual returns (uint8) {
    return 8;
  }

  /* ================= IERC20 Views ================ */

  function totalSupply() public view returns (uint256) {
    if (rebaseFinish == 0) {
      return _totalSupply;
    }

    uint256 endTime = Math.min(block.timestamp, rebaseFinish);
    uint256 pendingRebase = (endTime - lastRebaseSettleTime).mulDiv(rebaseRate, RebaseRateScale, Math.Rounding.Floor);
    return _totalSupply + pendingRebase;
  }

  function balanceOf(address account) public view returns (uint256) {
    return _convertToBalance(_shares[account], Math.Rounding.Floor);
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

  function getSharesByBalance(uint256 balance) external view returns (uint256) {
    return _convertToShares(balance, Math.Rounding.Floor);
  }

  function getBalanceByShares(uint256 sharesAmount) external view returns (uint256) {
    return _convertToBalance(sharesAmount, Math.Rounding.Floor);
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
    _approve(_msgSender(), spender, _allowances[_msgSender()][spender] + addedValue);
    return true;
  }

  function decreaseAllowance(address spender, uint256 subtractedValue) external nonReentrant returns (bool) {
    uint256 currentAllowance = _allowances[_msgSender()][spender];
    require(currentAllowance >= subtractedValue, "Allowance below zero");
    _approve(_msgSender(), spender, currentAllowance - subtractedValue);
    return true;
  }

  /* ================= IPToken Functions ================ */

  function mint(address to, uint256 amount) external nonReentrant onlyVault returns (uint256) {
    require(to != address(0), "Zero address detected");
    require(amount > 0, 'Amount too small');

    _settleRebase();

    uint256 sharesAmount = _convertToShares(amount, Math.Rounding.Floor);
    _mintShares(to, sharesAmount);
    _totalSupply = _totalSupply + amount;

    _emitTransferEvents(address(0), to, amount, sharesAmount);

    return sharesAmount;
  }

  function rebase(uint256 addedSupply, uint256 duration) external nonReentrant onlyVault {
    require(addedSupply > 0 && duration > 0, "Invalid rebase parameters");

    _settleRebase();

    if (block.timestamp >= rebaseFinish) {
      rebaseRate = addedSupply.mulDiv(RebaseRateScale, duration, Math.Rounding.Floor);
    }
    else {
      uint256 leftover = (rebaseFinish - block.timestamp).mulDiv(rebaseRate, RebaseRateScale, Math.Rounding.Floor);
      rebaseRate = (addedSupply + leftover).mulDiv(RebaseRateScale, duration, Math.Rounding.Floor);
    }

    lastRebaseSettleTime = block.timestamp;
    rebaseFinish = block.timestamp + duration;

    emit Rebased(addedSupply, duration);
  }

  function burn(address account, uint256 amount) external nonReentrant onlyVault returns (uint256) {
    require(account != address(0), "Zero address detected");
    require(amount > 0, 'Amount too small');

    _settleRebase();

    uint256 sharesAmount = _convertToShares(amount, Math.Rounding.Ceil);
    _burnShares(account, sharesAmount);
    _totalSupply = _totalSupply - amount;

    _emitTransferEvents(account, address(0), amount, sharesAmount);

    return sharesAmount;
  }

  function transferShares(address to, uint256 sharesAmount) external nonReentrant returns (uint256) {
    _transferShares(_msgSender(), to, sharesAmount);
    uint256 tokensAmount = _convertToBalance(sharesAmount, Math.Rounding.Floor);
    _emitTransferEvents(_msgSender(), to, tokensAmount, sharesAmount);
    return tokensAmount;
  }

  function transferSharesFrom(address sender, address to, uint256 sharesAmount) external nonReentrant returns (uint256) {
    uint256 tokensAmount = _convertToBalance(sharesAmount, Math.Rounding.Floor);
    _spendAllowance(sender, _msgSender(), tokensAmount);
    _transferShares(sender, to, sharesAmount);
    _emitTransferEvents(sender, to, tokensAmount, sharesAmount);
    return tokensAmount;
  }

  /* ================= INTERNAL Functions ================ */

  function _settleRebase() internal {
    if (rebaseFinish > 0) {
      uint256 endTime = Math.min(block.timestamp, rebaseFinish);
      uint256 settleAmount = (endTime - lastRebaseSettleTime).mulDiv(rebaseRate, RebaseRateScale, Math.Rounding.Floor);
      _totalSupply = _totalSupply + settleAmount;
    }
    lastRebaseSettleTime = Math.min(block.timestamp, rebaseFinish);
  }

  function _convertToShares(uint256 balance, Math.Rounding rounding) internal view virtual returns (uint256) {
    return balance.mulDiv(
      _totalShares + 10 ** decimalsOffset(),
      totalSupply() + 1,
      rounding
    );
  }

  function _convertToBalance(uint256 shares, Math.Rounding rounding) internal view virtual returns (uint256) {
    return shares.mulDiv(
      totalSupply() + 1,
      _totalShares + 10 ** decimalsOffset(), 
      rounding
    );
  }

  function _transfer(address sender, address to, uint256 amount) internal {
    uint256 _sharesToTransfer = _convertToShares(amount, Math.Rounding.Floor);
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

    _shares[from] = currentSenderShares - sharesAmount;
    _shares[to] = _shares[to] + sharesAmount;
  }

  function _mintShares(address to, uint256 sharesAmount) internal returns (uint256) {
    require(to != address(0), "Mint to zero address");

    _totalShares = _totalShares + sharesAmount;
    _shares[to] = _shares[to] + sharesAmount;

    return _totalShares;
  }

  function _burnShares(address account, uint256 sharesAmount) internal returns (uint256) {
    require(account != address(0), "Burn from zero address");

    require(sharesAmount <= _shares[account], "Balance exceeded");

    _totalShares = _totalShares - sharesAmount;
    _shares[account] = _shares[account] - sharesAmount;

    return _totalShares;
  }

  function _emitTransferEvents(address from, address to, uint256 tokenAmount, uint256 sharesAmount) internal {
    emit Transfer(from, to, tokenAmount);
    emit TransferShares(from, to, sharesAmount);
  }

  /* ============== MODIFIERS =============== */

  modifier onlyVault() virtual {
    require(vault == _msgSender(), "Caller is not Vault");
    _;
  }

  /* ================= Events ================ */

  event TransferShares(address indexed from, address indexed to, uint256 sharesValue);
  event Rebased(uint256 addedSupply, uint256 duration);
}
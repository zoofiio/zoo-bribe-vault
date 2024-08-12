// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./MockERC20.sol";

contract MockRebasableERC20 is MockERC20 {
  using SafeMath for uint256;

  constructor(
    string memory name, string memory symbol
  ) MockERC20(name, symbol) {
    
  }

  uint256 private _totalShares;
  uint256 private _totalSupply;

  // balance = shares[account] * _getTotalSupply() / _getTotalShares()
  mapping (address => uint256) private shares;

  /**
   * @dev Allowances are nominated in tokens, not token shares.
  */
  mapping (address => mapping (address => uint256)) private allowances;

  /* ================= VIEWS ================ */

  function totalSupply() public view override returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address _account) public view override returns (uint256) {
    return getBalanceByShares(sharesOf(_account));
  }

  function allowance(address _owner, address _spender) public view override returns (uint256) {
    return allowances[_owner][_spender];
  }

  function sharesOf(address _account) public view returns (uint256) {
    return shares[_account];
  }

  function getSharesByTokenAmount(uint256 amount) public view returns (uint256) {
    if (_totalSupply == 0) {
      return 0;
    } else {
      return amount
        .mul(_totalShares)
        .div(_totalSupply);
    }
  }

  function getBalanceByShares(uint256 _sharesAmount) public view returns (uint256) {
    if (_totalShares == 0) {
      return 0;
    } else {
      return _sharesAmount
        .mul(_totalSupply)
        .div(_totalShares);
    }
  }


  /* ================= MUTATIVE FUNCTIONS ================ */

  function transfer(address _recipient, uint256 _amount) public override returns (bool) {
    _transfer(msg.sender, _recipient, _amount);
    return true;
  }

  function transferFrom(address _sender, address _recipient, uint256 _amount) public override returns (bool) {
    uint256 currentAllowance = allowances[_sender][msg.sender];
    require(currentAllowance >= _amount, "TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE");

    _transfer(_sender, _recipient, _amount);
    _approve(_sender, msg.sender, currentAllowance.sub(_amount));
    return true;
  }

  function approve(address _spender, uint256 _amount) public override returns (bool) {
    _approve(msg.sender, _spender, _amount);
    return true;
  }

  function mint(address to, uint256 amount) public override nonReentrant onlyAdmin returns (bool) {
    require(amount > 0, "Cannot mint 0");

    uint256 sharesAmount = getSharesByTokenAmount(amount);
    if (sharesAmount == 0) {
      sharesAmount = amount;
    }
    _mintShares(to, sharesAmount);

    _totalSupply = _totalSupply.add(amount);

    _emitTransferAfterMintingShares(to, sharesAmount);

    return true;
  }

  function burn(uint256 amount) public override {
    require(amount > 0, "Cannot mint 0");

    uint256 sharesAmount = getSharesByTokenAmount(amount);
    if (sharesAmount == 0) {
      sharesAmount = amount;
    }
    _burnShares(msg.sender, sharesAmount);

    _totalSupply = _totalSupply.sub(amount);

    emit Transfer(msg.sender, address(0), getBalanceByShares(sharesAmount));
    emit TransferShares(msg.sender, address(0), sharesAmount);
  }

  /**
   * @dev Destroys `amount` tokens from `account`, deducting from the caller's
   * allowance.
   *
   * - the caller must have allowance for ``accounts``'s tokens of at least
   * `amount`.
   */
  function burnFrom(address, uint256) public pure override {
    revert("Unsupported");
  }

  function addRewards(uint256 amount) external nonReentrant onlyAdmin {
    require(amount > 0, "Cannot mint 0");
    _totalSupply = _totalSupply.add(amount);

    emit AddRewards(msg.sender, amount);
  }

  function submitPenalties(uint256 amount) external nonReentrant onlyAdmin {
    require(amount > 0, "Cannot burn 0");
    require(amount <= _totalSupply, "Cannot burn more than total supply");
    _totalSupply = _totalSupply.sub(amount);

    emit SubmitPenalties(msg.sender, amount);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _transfer(address _sender, address _recipient, uint256 _amount) override internal {
    uint256 _sharesToTransfer = getSharesByTokenAmount(_amount);
    _transferShares(_sender, _recipient, _sharesToTransfer);
    emit Transfer(_sender, _recipient, _amount);
    emit TransferShares(_sender, _recipient, _sharesToTransfer);
  }

  function _transferShares(address _sender, address _recipient, uint256 _sharesAmount) internal {
    require(_sender != address(0), "TRANSFER_FROM_THE_ZERO_ADDRESS");
    require(_recipient != address(0), "TRANSFER_TO_THE_ZERO_ADDRESS");

    uint256 currentSenderShares = shares[_sender];
    require(_sharesAmount <= currentSenderShares, "TRANSFER_AMOUNT_EXCEEDS_BALANCE");

    shares[_sender] = currentSenderShares.sub(_sharesAmount);
    shares[_recipient] = shares[_recipient].add(_sharesAmount);
  }

  function _approve(address _owner, address _spender, uint256 _amount) internal override {
    require(_owner != address(0), "APPROVE_FROM_ZERO_ADDRESS");
    require(_spender != address(0), "APPROVE_TO_ZERO_ADDRESS");

    allowances[_owner][_spender] = _amount;
    emit Approval(_owner, _spender, _amount);
  }

  function _mintShares(address _recipient, uint256 _sharesAmount) internal returns (uint256 newTotalShares) {
    require(_recipient != address(0), "MINT_TO_THE_ZERO_ADDRESS");

    newTotalShares = _totalShares.add(_sharesAmount);
    _totalShares = newTotalShares;

    shares[_recipient] = shares[_recipient].add(_sharesAmount);
  }

  function _burnShares(address _account, uint256 _sharesAmount) internal returns (uint256 newTotalShares) {
    require(_account != address(0), "BURN_FROM_THE_ZERO_ADDRESS");

    uint256 accountShares = shares[_account];
    require(_sharesAmount <= accountShares, "BURN_AMOUNT_EXCEEDS_BALANCE");

    uint256 preRebaseTokenAmount = getBalanceByShares(_sharesAmount);

    newTotalShares = _totalShares.sub(_sharesAmount);
    _totalShares = newTotalShares;

    shares[_account] = accountShares.sub(_sharesAmount);

    uint256 postRebaseTokenAmount = getBalanceByShares(_sharesAmount);

    emit SharesBurnt(_account, preRebaseTokenAmount, postRebaseTokenAmount, _sharesAmount);
  }

  function _emitTransferAfterMintingShares(address _to, uint256 _sharesAmount) internal {
    emit Transfer(address(0), _to, getBalanceByShares(_sharesAmount));
    emit TransferShares(address(0), _to, _sharesAmount);
  }

  /* ========== EVENTS ========== */

  event TransferShares(
    address indexed from,
    address indexed to,
    uint256 sharesValue
  );

  event SharesBurnt(
    address indexed account,
    uint256 preRebaseTokenAmount,
    uint256 postRebaseTokenAmount,
    uint256 sharesAmount
  );

  event AddRewards(
    address indexed rewarder,
    uint256 amount
  );

  event SubmitPenalties(
    address indexed submitter,
    uint256 amount
  );

}
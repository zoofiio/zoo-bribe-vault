// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";

contract RedeemPool is Context, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /* ========== STATE VARIABLES ========== */

  IVault internal immutable _vault;
  bool internal _settled;

  address internal _redeemingPToken;  // $piBGT
  address internal _assetToken;  // $iBGT

  uint256 internal _totalRedeemingShares;  // $piBGT shares
  mapping(address => uint256) internal _userRedeemingShares;

  uint256 internal _assetAmountPerRedeemingShare;   // $iBGT amount
  mapping(address => uint256) internal _userAssetAmountPerRedeemingSharePaid;
  mapping(address => uint256) internal _userAssetAmounts;

  /* ========== CONSTRUCTOR ========== */

  constructor(
    address _vault_
  ) {
    _vault = IVault(_vault_);

    _redeemingPToken = _vault.pToken();
    _assetToken = _vault.assetToken();
  }

  /* ========== VIEWS ========== */

  function vault() public view returns (address) {
    return address(_vault);
  }

  function redeemingToken() public view returns (address) {
    return _redeemingPToken;
  }

  function assetToken() public view returns (address) {
    return _assetToken;
  }

  function totalRedeemingShares() public view returns (uint256) {
    return _totalRedeemingShares;
  }

  // $piBGT
  function totalRedeemingBalance() public view returns (uint256) {
    return IERC20(_redeemingPToken).balanceOf(address(this));
  }

  function userRedeemingShares(address account) public view returns (uint256) {
    return _userRedeemingShares[account];
  }

  // $piBGT
  function userRedeemingBalance(address account) public view returns (uint256) {
    return getRedeemingBalanceByShares(_userRedeemingShares[account]);
  }

  // $iBGT
  function earnedAssetAmount(address account) public view returns (uint256) {
    return _userRedeemingShares[account].mul(_assetAmountPerRedeemingShare.sub(_userAssetAmountPerRedeemingSharePaid[account])).div(1e18).add(_userAssetAmounts[account]);
  }

  function getRedeemingSharesByBalance(uint256 stakingBalance) public view returns (uint256) {
    if (totalRedeemingBalance() == 0 || _totalRedeemingShares == 0) return stakingBalance;

    return stakingBalance
      .mul(_totalRedeemingShares)
      .div(totalRedeemingBalance());
  }

  function getRedeemingBalanceByShares(uint256 stakingShares) public view returns (uint256) {
    if (_totalRedeemingShares == 0) return 0;
  
    return stakingShares
      .mul(totalRedeemingBalance())
      .div(_totalRedeemingShares);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function redeem(uint256 amount) external payable nonReentrant onlyUnsettled updateAssetAmount(_msgSender()) {
    require(amount > 0, "Cannot stake 0");
    require(msg.value == 0, "msg.value should be 0");

    uint256 sharesAmount = getRedeemingSharesByBalance(amount);
    _totalRedeemingShares = _totalRedeemingShares.add(sharesAmount);
    _userRedeemingShares[_msgSender()] = _userRedeemingShares[_msgSender()].add(sharesAmount);

    TokensTransfer.transferTokens(_redeemingPToken, _msgSender(), address(this), amount);
    emit Redeem(_msgSender(), amount);
  }

  function withdrawRedeem(uint256 amount) public nonReentrant onlyUnsettled updateAssetAmount(_msgSender()) {
    require(amount > 0, "Cannot withdraw 0");
    require(amount <= userRedeemingBalance(_msgSender()), "Insufficient balance");

    uint256 sharesAmount = getRedeemingSharesByBalance(amount);
    _totalRedeemingShares = _totalRedeemingShares.sub(sharesAmount);
    _userRedeemingShares[_msgSender()] = _userRedeemingShares[_msgSender()].sub(sharesAmount);

    TokensTransfer.transferTokens(_redeemingPToken, address(this), _msgSender(), amount);
    emit WithdrawRedeem(_msgSender(), amount);
  }

  // $iBGT
  function claimAssetToken() public nonReentrant updateAssetAmount(_msgSender()) {
    uint256 amount = _userAssetAmounts[_msgSender()];
    if (amount > 0) {
      _userAssetAmounts[_msgSender()] = 0;
      IERC20(_assetToken).transfer(_msgSender(), amount);
      emit AssetTokenPaid(_msgSender(), amount);
    }
  }

  function exit() external {
    if (!_settled) {
      withdrawRedeem(userRedeemingBalance(_msgSender()));
    } 
    claimAssetToken();
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function notifySettlement(uint256 assetAmount) external nonReentrant onlyUnsettled onlyVault {
    _settled = true;
    _assetAmountPerRedeemingShare = _assetAmountPerRedeemingShare.add(assetAmount.mul(1e18).div(_totalRedeemingShares));
    emit Settlement(assetAmount);
  }

  /* ========== MODIFIERS ========== */

  modifier onlyUnsettled() {
    require(!_settled, "Settled");
    _;
  }

  modifier onlyVault() {
    require(_msgSender() == address(_vault), "Caller is not Vault");
    _;
  }

  modifier updateAssetAmount(address account) {
    if (account != address(0)) {
      _userAssetAmounts[account] = earnedAssetAmount(account);
      _userAssetAmountPerRedeemingSharePaid[account] = _assetAmountPerRedeemingShare;
    }
    _;
  }

  /* ========== EVENTS ========== */

  event Redeem(address indexed user, uint256 amount);
  event WithdrawRedeem(address indexed user, uint256 amount);

  event AssetTokenPaid(address indexed user, uint256 amount);
  event Settlement(uint256 assetAmount);
}
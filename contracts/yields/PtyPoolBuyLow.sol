// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IUsd.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IZooProtocol.sol";
import "../settings/ProtocolOwner.sol";

contract PtyPoolBuyLow is ProtocolOwner, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /* ========== STATE VARIABLES ========== */

  IProtocolSettings public immutable settings;
  IVault internal immutable _vault;

  address internal _stakingUsdToken;  // $zUSD
  address internal _targetAssetToken;  // $ETH / $WBTC / ...
  address internal _stakingYieldsMarginToken;  // $ETHx / ...
  address internal _matchingYieldsAssetToken;  // $ETH / ...

  uint256 internal _totalStakingShares; // $zUSD LP shares
  mapping(address => uint256) internal _userStakingShares;

  uint256 internal _accruedMatchingYields;  // $ETH / $WBTC / ...
  uint256 internal _matchingYieldsPerShare;
  mapping(address => uint256) internal _userMatchingYieldsPerSharePaid;
  mapping(address => uint256) internal _userMatchingYields;
  
  uint256 internal _targetTokensPerShare;  // $ETH / $WBTC / ...
  mapping(address => uint256) internal _userTargetTokensPerSharePaid;
  mapping(address => uint256) internal _userTargetTokens;

  uint256 internal _stakingYieldsPerShare;  // $ETHx / ...
  mapping(address => uint256) internal _userStakingYieldsPerSharePaid;
  mapping(address => uint256) internal _userStakingYields;

  /* ========== CONSTRUCTOR ========== */

  constructor(
    address _protocol,
    address _settings,
    address _vault_,
    address _stakingYieldsToken_,
    address _matchingYieldsToken_
  ) ProtocolOwner(_protocol) {
    settings = IProtocolSettings(_settings);
    _vault = IVault(_vault_);

    _stakingYieldsMarginToken = _stakingYieldsToken_;
    _matchingYieldsAssetToken = _matchingYieldsToken_;

    _stakingUsdToken = protocol.usdToken();
    _targetAssetToken = _vault.assetToken();

    require(_targetAssetToken == _matchingYieldsAssetToken, "PtyPoolBuyLow: target token and matching yields token mismatch");
  }

  receive() external payable {}

  /* ========== VIEWS ========== */

  function vault() public view returns (address) {
    return address(_vault);
  }

  // $zUSD
  function stakingToken() public view returns (address) {
    return _stakingUsdToken;
  }

  // $ETH
  function targetToken() public view returns (address) {
    return _targetAssetToken;
  }

  // $ETHx
  function stakingYieldsToken() public view returns (address) {
    return _stakingYieldsMarginToken;
  }

  // $ETH
  function matchingYieldsToken() public view returns (address) {
    return _matchingYieldsAssetToken;
  }

  function totalStakingShares() public view returns (uint256) {
    return _totalStakingShares;
  }

  function totalStakingBalance() external view returns (uint256) {
    return _totalStakingBalance();
  }

  function userStakingShares(address account) public view returns (uint256) {
    return _userStakingShares[account];
  }

  function userStakingBalance(address account) external view returns (uint256) {
    return _userStakingBalance(account);
  }

  // $ETHx
  function earnedStakingYields(address account) public view returns (uint256) {
    return _userStakingShares[account].mul(_stakingYieldsPerShare.sub(_userStakingYieldsPerSharePaid[account])).div(1e18).add(_userStakingYields[account]);
  }

  // $ETH
  function earnedMatchingYields(address account) public view returns (uint256) {
    return _userStakingShares[account].mul(_matchingYieldsPerShare.sub(_userMatchingYieldsPerSharePaid[account])).div(1e18).add(_userMatchingYields[account]);
  }

  // $ETH
  function earnedMatchedToken(address account) public view returns (uint256) {
    return _userStakingShares[account].mul(_targetTokensPerShare.sub(_userTargetTokensPerSharePaid[account])).div(1e18).add(_userTargetTokens[account]);
  }

  function getStakingSharesByBalance(uint256 stakingBalance) external view returns (uint256) {
    return _getStakingSharesByBalance(stakingBalance);
  }

  function getStakingBalanceByShares(uint256 stakingShares) external view returns (uint256) {
    return _getStakingBalanceByShares(stakingShares);
  }

  // $ETH
  function getAccruedMatchingYields() public view returns (uint256) {
    return _accruedMatchingYields;
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function stake(uint256 amount) external nonReentrant
    updateStakingYields(_msgSender()) updateMatchingYields(_msgSender()) updateTargetTokens(_msgSender()) {
    require(amount > 0, "Cannot stake 0");

    uint256 sharesAmount = _getStakingSharesByBalance(amount);
    _totalStakingShares = _totalStakingShares.add(sharesAmount);
    _userStakingShares[_msgSender()] = _userStakingShares[_msgSender()].add(sharesAmount);

    TokensTransfer.transferTokens(_stakingUsdToken, _msgSender(), address(this), amount);
    emit Staked(_msgSender(), amount);
  }

  function withdraw(uint256 amount) public nonReentrant
    updateStakingYields(_msgSender()) updateMatchingYields(_msgSender()) updateTargetTokens(_msgSender()) {

    require(amount > 0, "Cannot withdraw 0");
    require(amount <= _userStakingBalance(_msgSender()), "Insufficient balance");

    uint256 sharesAmount = _getStakingSharesByBalance(amount);
    _totalStakingShares = _totalStakingShares.sub(sharesAmount);
    _userStakingShares[_msgSender()] = _userStakingShares[_msgSender()].sub(sharesAmount);

    TokensTransfer.transferTokens(_stakingUsdToken, address(this), _msgSender(), amount);
    emit Withdrawn(_msgSender(), amount);
  }

  function getStakingYields() public nonReentrant updateStakingYields(_msgSender()) {
    uint256 userYields = _userStakingYields[_msgSender()];
    if (userYields > 0) {
      _userStakingYields[_msgSender()] = 0;
      TokensTransfer.transferTokens(_stakingYieldsMarginToken, address(this), _msgSender(), userYields);
      emit StakingYieldsPaid(_msgSender(), userYields);
    }
  }

  function getMatchingYields() public nonReentrant updateMatchingYields(_msgSender()) {
    uint256 userYields = _userMatchingYields[_msgSender()];
    if (userYields > 0) {
      _userMatchingYields[_msgSender()] = 0;
      TokensTransfer.transferTokens(_matchingYieldsAssetToken, address(this), _msgSender(), userYields);
      emit MatchingYieldsPaid(_msgSender(), userYields);
    }
  }

  function getMatchingOutTokens() public nonReentrant updateTargetTokens(_msgSender()) {
    uint256 userMatchedTokens = _userTargetTokens[_msgSender()];
    if (userMatchedTokens > 0) {
      _userTargetTokens[_msgSender()] = 0;
      TokensTransfer.transferTokens(_targetAssetToken, address(this), _msgSender(), userMatchedTokens);
      emit MatchedTokenPaid(_msgSender(), userMatchedTokens);
    }
  }

  /**
   * @notice Useful for Pty Pools Buy Low, since matching out tokens and yields tokens are all asset tokens.
   */
  function getMatchingTokensAndYields() external {
    getMatchingOutTokens();
    getMatchingYields();
  }

  function claimAll() external {
    getMatchingOutTokens();
    getMatchingYields();
    getStakingYields();
  }

  function exit() external {
    withdraw(_userStakingBalance(_msgSender()));
    getStakingYields();
    getMatchingYields();
    getMatchingOutTokens();
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  /**
   * Rescue tokens that are accidently sent to this contract
   */
  function rescue(address token, address recipient) external nonReentrant onlyOwner {
    require(token != address(0) && recipient != address(0), "Zero address detected");
    require(token != _stakingUsdToken && token != _targetAssetToken && token != _stakingYieldsMarginToken && token != _matchingYieldsAssetToken, "Cannot rescue staking or yield tokens");

    uint256 amount;
    if (token == Constants.NATIVE_TOKEN) {
      amount = address(this).balance;
    }
    else {
      amount = IERC20(token).balanceOf(address(this));
    }
    require(amount > 0, "No tokens to rescue");

    TokensTransfer.transferTokens(token, address(this), recipient, amount);
    emit TokenRescued(token, recipient, amount);
  }

  // $ETHx; $ETHx should be transferred to this contract before calling this function
  function addStakingYields(uint256 yieldsAmount) external nonReentrant updateStakingYields(address(0)) onlyVault {
    require(yieldsAmount > 0, "Too small yields amount");
    require(_totalStakingShares > 0, "No user stakes");

    _stakingYieldsPerShare = _stakingYieldsPerShare.add(yieldsAmount.mul(1e18).div(_totalStakingShares));
    emit StakingYieldsAdded(yieldsAmount);
  }

  // $ETH; $ETH should be transferred to this contract before calling this function
  function addMatchingYields(uint256 yieldsAmount) external nonReentrant updateMatchingYields(address(0)) onlyVault {
    require(yieldsAmount > 0, "Too small yields amount");
    require(_totalStakingShares > 0, "No user stakes");
    _accruedMatchingYields = _accruedMatchingYields.add(yieldsAmount);
    emit MatchingYieldsAdded(yieldsAmount);
  }

  // $ETH; before calling this function, $zUSD should be burned, and $ETH should be transferred to this contract
  function notifyBuyLowTriggered(uint256 assetAmountAdded) external nonReentrant updateTargetTokens(address(0)) onlyVault {
    // require(_vault.vaultMode() == Constants.VaultMode.AdjustmentBelowAARS, "Vault not in adjustment below AARS mode");

    _targetTokensPerShare = _targetTokensPerShare.add(assetAmountAdded.mul(1e18).div(_totalStakingShares));
    emit MatchedTokensAdded(assetAmountAdded);

    if (_accruedMatchingYields > 0) {
      _matchingYieldsPerShare = _matchingYieldsPerShare.add(_accruedMatchingYields.mul(1e18).div(_totalStakingShares));
      _accruedMatchingYields = 0;
    }
  }

  /* ================= INTERNAL Functions ================ */

  function _userStakingBalance(address account) internal view returns (uint256) {
    return _getStakingBalanceByShares(_userStakingShares[account]);
  }

  function _totalStakingBalance() internal view returns (uint256) {
    return IERC20(_stakingUsdToken).balanceOf(address(this));
  }

  function _getStakingSharesByBalance(uint256 stakingBalance) internal view returns (uint256) {
    if (_totalStakingBalance() == 0 || _totalStakingShares == 0) return stakingBalance;

    return stakingBalance
      .mul(_totalStakingShares)
      .div(_totalStakingBalance());
  }

  function _getStakingBalanceByShares(uint256 stakingShares) internal view returns (uint256) {
    if (_totalStakingShares == 0) return 0;
  
    return stakingShares
      .mul(_totalStakingBalance())
      .div(_totalStakingShares);
  }

  /* ========== MODIFIERS ========== */

  modifier onlyVault() {
    require(_msgSender() == address(_vault), "Caller is not Vault");
    _;
  }

  modifier updateStakingYields(address account) {
    if (account != address(0)) {
      _userStakingYields[account] = earnedStakingYields(account);
      _userStakingYieldsPerSharePaid[account] = _stakingYieldsPerShare;
    }
    _;
  }

  modifier updateMatchingYields(address account) {
    if (account != address(0)) {
      _userMatchingYields[account] = earnedMatchingYields(account);
      _userMatchingYieldsPerSharePaid[account] = _matchingYieldsPerShare;
    }
    _;
  }

  modifier updateTargetTokens(address account) {
    if (account != address(0)) {
      _userTargetTokens[account] = earnedMatchedToken(account);
      _userTargetTokensPerSharePaid[account] = _targetTokensPerShare;
    }
    _;
  }

  /* ========== EVENTS ========== */

  event Staked(address indexed user, uint256 amount);
  event Withdrawn(address indexed user, uint256 amount);

  event StakingYieldsAdded(uint256 yields);
  event MatchingYieldsAdded(uint256 yields);
  event MatchedTokensAdded(uint256 amount);

  event StakingYieldsPaid(address indexed user, uint256 yields);
  event MatchingYieldsPaid(address indexed user, uint256 yields);
  event MatchedTokenPaid(address indexed user, uint256 amount);

  event TokenRescued(address indexed token, address indexed recipient, uint256 amount);
}
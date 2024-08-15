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

contract PtyPoolSellHigh is ProtocolOwner, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /* ========== STATE VARIABLES ========== */

  IProtocolSettings public immutable settings;
  IVault internal immutable _vault;

  address internal _stakingAssetToken;  // $ETH / $WBTC / ...
  address internal _matchingUsdToken;  // $zUSD
  address internal _stakingYieldsAssetToken;  // $ETH / $WBTC / ...
  address internal _matchingYieldsMarginToken;  // $ETHx / $WBTCx / ...

  uint256 internal _totalStakingShares;  // $ETH shares
  mapping(address => uint256) internal _userStakingShares;

  uint256 internal _accruedMatchingYields;   // $ETHx ...
  uint256 internal _matchingYieldsPerShare;  // $ETHx per $ETH staking share
  mapping(address => uint256) internal _userMatchingYieldsPerSharePaid;
  mapping(address => uint256) internal _userMatchingYields;
  
  uint256 internal _usdSharesPerStakingShare;   // $zUSD shares
  mapping(address => uint256) internal _userUsdSharesPerStakingSharePaid;
  mapping(address => uint256) internal _userUsdShares;

  /* ========== CONSTRUCTOR ========== */

  constructor(
    address _protocol,
    address _settings,
    address _vault_,
    address _stakingYieldsToken_,  // $ETH
    address _matchingYieldsToken_  // $ETHx
  ) ProtocolOwner(_protocol) {
    settings = IProtocolSettings(_settings);
    _vault = IVault(_vault_);

    _stakingAssetToken = _vault.assetToken();
    _matchingUsdToken = protocol.usdToken();

    _stakingYieldsAssetToken = _stakingYieldsToken_;
    _matchingYieldsMarginToken = _matchingYieldsToken_;

    require(_stakingAssetToken == _stakingYieldsAssetToken, "PtyPoolSellHigh: staking token and staking yields token mismatch");
  }

  receive() external payable {}

  /* ========== VIEWS ========== */

  function vault() public view returns (address) {
    return address(_vault);
  }

  function stakingToken() public view returns (address) {
    return _stakingAssetToken;
  }

  function targetToken() public view returns (address) {
    return _matchingUsdToken;
  }

  function stakingYieldsToken() public view returns (address) {
    return _stakingYieldsAssetToken;
  }

  function matchingYieldsToken() public view returns (address) {
    return _matchingYieldsMarginToken;
  }

  function totalStakingShares() public view returns (uint256) {
    return _totalStakingShares;
  }

  // $ETH
  function totalStakingBalance() external view returns (uint256) {
    return _totalStakingBalance(0);
  }

  function userStakingShares(address account) public view returns (uint256) {
    return _userStakingShares[account];
  }

  // $ETH
  function userStakingBalance(address account) external view returns (uint256) {
    return _userStakingBalance(account, 0);
  }

  // $ETHx
  function earnedMatchingYields(address account) public view returns (uint256) {
    return _userStakingShares[account].mul(_matchingYieldsPerShare.sub(_userMatchingYieldsPerSharePaid[account])).div(1e18).add(_userMatchingYields[account]);
  }

  // $zUSD
  function earnedMatchedToken(address account) public view returns (uint256) {
    uint256 earnedMatchedUsdShares = _earnedMatchedTokenShares(account);
    return IUsd(_matchingUsdToken).getBalanceByShares(earnedMatchedUsdShares);
  }

  // $zUSD shares
  function _earnedMatchedTokenShares(address account) internal view returns (uint256) {
    return _userStakingShares[account].mul(_usdSharesPerStakingShare.sub(_userUsdSharesPerStakingSharePaid[account])).div(1e18).add(_userUsdShares[account]);
  }

  function getStakingSharesByBalance(uint256 stakingBalance) external view returns (uint256) {
    return _getStakingSharesByBalance(stakingBalance, 0);
  }

  function getStakingBalanceByShares(uint256 stakingShares) external view returns (uint256) {
    return _getStakingBalanceByShares(stakingShares, 0);
  }

  // $ETHx
  function getAccruedMatchingYields() public view returns(uint256){
    return _accruedMatchingYields;
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function stake(uint256 amount) external payable nonReentrant
    updateMatchingYields(_msgSender()) updateTargetTokens(_msgSender()) {

    require(amount > 0, "Cannot stake 0");
    if (_stakingAssetToken == Constants.NATIVE_TOKEN) {
      require(msg.value == amount, "Incorrect msg.value");
    }
    else {
      require(msg.value == 0, "msg.value should be 0");
    }

    uint256 sharesAmount = _getStakingSharesByBalance(amount, msg.value);
    _totalStakingShares = _totalStakingShares.add(sharesAmount);
    _userStakingShares[_msgSender()] = _userStakingShares[_msgSender()].add(sharesAmount);

    TokensTransfer.transferTokens(_stakingAssetToken, _msgSender(), address(this), amount);
    emit Staked(_msgSender(), amount);
  }

  function withdraw(uint256 amount) public nonReentrant
    updateMatchingYields(_msgSender()) updateTargetTokens(_msgSender()) {

    require(amount > 0, "Cannot withdraw 0");
    require(amount <= _userStakingBalance(_msgSender(), 0), "Insufficient balance");

    uint256 sharesAmount = _getStakingSharesByBalance(amount, 0);
    _totalStakingShares = _totalStakingShares.sub(sharesAmount);
    _userStakingShares[_msgSender()] = _userStakingShares[_msgSender()].sub(sharesAmount);

    TokensTransfer.transferTokens(_stakingAssetToken, address(this), _msgSender(), amount);
    emit Withdrawn(_msgSender(), amount);
  }

  // $ETHx
  function getMatchingYields() public nonReentrant updateMatchingYields(_msgSender()) {
    uint256 userYields = _userMatchingYields[_msgSender()];
    if (userYields > 0) {
      _userMatchingYields[_msgSender()] = 0;
      TokensTransfer.transferTokens(_matchingYieldsMarginToken, address(this), _msgSender(), userYields);
      emit MatchingYieldsPaid(_msgSender(), userYields);
    }
  }

  // $zUSD
  function getMatchingOutTokens() public nonReentrant updateTargetTokens(_msgSender()) {
    uint256 userUsdShares = _userUsdShares[_msgSender()];
    if (userUsdShares > 0) {
      _userUsdShares[_msgSender()] = 0;
      IUsd(_matchingUsdToken).transferShares(_msgSender(), userUsdShares);
      emit MatchedTokenPaid(_msgSender(), IUsd(_matchingUsdToken).getBalanceByShares(userUsdShares));
    }
  }

  function getMatchingTokensAndYields() external {
    getMatchingOutTokens();
    getMatchingYields();
  }

  function claimAll() external {
    getMatchingOutTokens();
    getMatchingYields();
  }

  function exit() external {
    withdraw(_userStakingBalance(_msgSender(), 0));
    getMatchingYields();
    getMatchingOutTokens();
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  /**
   * Rescue tokens that are accidently sent to this contract
   */
  function rescue(address token, address recipient) external nonReentrant onlyOwner {
    require(token != address(0) && recipient != address(0), "Zero address detected");
    require(token != _stakingAssetToken && token != _matchingUsdToken && token != _stakingYieldsAssetToken && token != _matchingYieldsMarginToken, "Cannot rescue staking or yield tokens");

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

  // $ETH; $ETH should be transferred to this contract before calling this function
  function addStakingYields(uint256 yieldsAmount) external nonReentrant onlyVault {
    require(yieldsAmount > 0, "Too small yields amount");
    require(_totalStakingShares > 0, "No user stakes");

    emit StakingYieldsAdded(yieldsAmount);
  }

  // $ETHx; $ETHx should be transferred to this contract before calling this function
  function addMatchingYields(uint256 yieldsAmount) external nonReentrant updateMatchingYields(address(0)) onlyVault {
    require(yieldsAmount > 0, "Too small yields amount");
    require(_totalStakingShares > 0, "No user stakes");
    _accruedMatchingYields = _accruedMatchingYields.add(yieldsAmount);
    emit MatchingYieldsAdded(yieldsAmount);
  }

  // $zUSD; $zUSD should be minted to this contract before calling this function
  function notifySellHighTriggered(uint256 assetAmountMatched, uint256 usdSharesReceived, address assetRecipient) external nonReentrant updateTargetTokens(address(0)) onlyVault {
    // require(_vault.vaultMode() == Constants.VaultMode.AdjustmentAboveAARU, "Vault not in adjustment above AARU mode");

    TokensTransfer.transferTokens(_stakingAssetToken, address(this), assetRecipient, assetAmountMatched);

    _usdSharesPerStakingShare = _usdSharesPerStakingShare.add(usdSharesReceived.mul(1e18).div(_totalStakingShares));
    emit MatchedTokensAdded(usdSharesReceived);

    // $ETHx
    if (_accruedMatchingYields > 0) {
      _matchingYieldsPerShare = _matchingYieldsPerShare.add(_accruedMatchingYields.mul(1e18).div(_totalStakingShares));
      _accruedMatchingYields = 0;
    }
  }

  /* ================= INTERNAL Functions ================ */

  function _userStakingBalance(address account, uint256 msgValue) internal view returns (uint256) {
    return _getStakingBalanceByShares(_userStakingShares[account], msgValue);
  }

  function _totalStakingBalance(uint256 msgValue) internal view returns (uint256) {
    if (_stakingAssetToken == Constants.NATIVE_TOKEN) {
      return address(this).balance.sub(msgValue);
    }
    else {
      return IERC20(_stakingAssetToken).balanceOf(address(this));
    }
  }

  function _getStakingSharesByBalance(uint256 stakingBalance, uint256 msgValue) internal view returns (uint256) {
    if (_totalStakingBalance(msgValue) == 0 || _totalStakingShares == 0) return stakingBalance;

    return stakingBalance
      .mul(_totalStakingShares)
      .div(_totalStakingBalance(msgValue));
  }

  function _getStakingBalanceByShares(uint256 stakingShares, uint256 msgValue) internal view returns (uint256) {
    if (_totalStakingShares == 0) return 0;
  
    return stakingShares
      .mul(_totalStakingBalance(msgValue))
      .div(_totalStakingShares);
  }

  /* ========== MODIFIERS ========== */

  modifier onlyVault() {
    require(_msgSender() == address(_vault), "Caller is not Vault");
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
      _userUsdShares[account] = _earnedMatchedTokenShares(account);
      _userUsdSharesPerStakingSharePaid[account] = _usdSharesPerStakingShare;
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
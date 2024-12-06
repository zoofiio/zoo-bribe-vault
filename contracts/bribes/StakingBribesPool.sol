// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../libs/TokensTransfer.sol";

contract StakingBribesPool is Context, ReentrancyGuard {
  using Math for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  /* ========== STATE VARIABLES ========== */

  address public immutable vault;

  EnumerableSet.AddressSet internal _bribeTokens;

  mapping(address => uint256) public bribesPerYT;  // (bribe token => bribes per YT)
  mapping(address => mapping(address => uint256)) public userBribesPerYTPaid; 
  mapping(address => mapping(address => uint256)) public userBribes;

  uint256 internal _totalSupply;
  mapping(address => uint256) internal _balances;

  /* ========== CONSTRUCTOR ========== */

  constructor(address _vault) {
    vault = _vault;
  }

  /* ========== VIEWS ========== */

  function totalSupply() external view returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address user) external view returns (uint256) {
    return _balances[user];
  }

  function earned(address user, address bribeToken) public view returns (uint256) {
    return _balances[user].mulDiv(
      bribesPerYT[bribeToken] - userBribesPerYTPaid[user][bribeToken],
      1e18
    ) + userBribes[user][bribeToken];
  }

  /// @dev No guarantees are made on the ordering
  function bribeTokens() external view returns (address[] memory) {
    return _bribeTokens.values();
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function getBribes() external nonReentrant updateAllBribes(_msgSender()) {
    for (uint256 i = 0; i < _bribeTokens.length(); i++) {
      address bribeToken = _bribeTokens.at(i);
      uint256 bribes = userBribes[_msgSender()][bribeToken];
      if (bribes > 0) {
        userBribes[_msgSender()][bribeToken] = 0;
        TokensTransfer.transferTokens(bribeToken, address(this), _msgSender(), bribes);
        emit BribesPaid(_msgSender(), bribeToken, bribes);
      }
    }

  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function notifyYTSwappedForUser(address user, uint256 deltaYTAmount) external nonReentrant onlyVault updateAllBribes(user) {
    require(user != address(0) && deltaYTAmount > 0, "Invalid input");

    _totalSupply = _totalSupply + deltaYTAmount;
    _balances[user] = _balances[user] + deltaYTAmount;

    emit YTAdded(user, deltaYTAmount);
  }

  function addBribes(address bribeToken, uint256 bribesAmount) external nonReentrant onlyVault updateBribes(address(0), bribeToken) {
    require(_totalSupply > 0, "Cannot add bribes without YT staked");
    require(bribesAmount > 0, "Too small bribes amount");

    if (!_bribeTokens.contains(bribeToken)) {
      _bribeTokens.add(bribeToken);
      emit BribeTokenAdded(bribeToken);
    }

    TokensTransfer.transferTokens(bribeToken, _msgSender(), address(this), bribesAmount);

    bribesPerYT[bribeToken] = bribesPerYT[bribeToken] + bribesAmount.mulDiv(1e18, _totalSupply);

    emit BribesAdded(bribeToken, bribesAmount);
  }

  /* ========== MODIFIERS ========== */

  modifier onlyVault() {
    require(_msgSender() == vault, "Caller is not Vault");
    _;
  }

  modifier updateAllBribes(address user) {
    for (uint256 i = 0; i < _bribeTokens.length(); i++) {
      address bribeToken = _bribeTokens.at(i);
      _updateBribes(user, bribeToken);
    }

    _;
  }

  modifier updateBribes(address user, address bribeToken) {
    _updateBribes(user, bribeToken);

    _;
  }

  function _updateBribes(address user, address bribeToken) internal {
    if (user != address(0)) {
      userBribes[user][bribeToken] = earned(user, bribeToken);
      userBribesPerYTPaid[user][bribeToken] = bribesPerYT[bribeToken];
    }
  }

  /* ========== EVENTS ========== */

  event BribeTokenAdded(address indexed bribeToken);

  event YTAdded(address indexed user, uint256 deltaYTAmount);

  event BribesAdded(address indexed bribeToken, uint256 bribes);

  event BribesPaid(address indexed user, address indexed bribeToken, uint256 bribes);

}

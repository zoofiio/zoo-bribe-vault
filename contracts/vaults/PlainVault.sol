// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../interfaces/IProtocolSettings.sol";
import "../settings/ProtocolOwner.sol";

contract PlainVault is ProtocolOwner, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IProtocolSettings public immutable settings;
  mapping(bytes32 => bool) internal _vaultParamsSet;
  mapping(bytes32 => uint256) internal _vaultParams;

  address public stakingToken;

  uint256 internal _totalSupply;
  mapping(address => uint256) internal _balances;

  /* ========== CONSTRUCTOR ========== */

  constructor(
    address _protocol,
    address _settings,
    address _stakingToken
  ) ProtocolOwner(_protocol) {
    settings = IProtocolSettings(_settings);
    stakingToken = _stakingToken;
  }

  receive() external payable {}

  /* ========== VIEWS ========== */

  function totalSupply() external view returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address account) external view returns (uint256) {
    return _balances[account];
  }

  function vaultParamValue(bytes32 param) public view returns (uint256) {
    require(param.length > 0, "Empty param name");

    if (_vaultParamsSet[param]) {
      return _vaultParams[param];
    }
    return settings.paramDefaultValue(param);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function stake(uint256 amount) external payable nonReentrant {
    require(amount > 0, "Cannot stake 0");
    if (stakingToken == Constants.NATIVE_TOKEN) {
      require(msg.value == amount, "Incorrect msg.value");
    }
    else {
      require(msg.value == 0, "msg.value should be 0");
    }

    _totalSupply = _totalSupply.add(amount);
    _balances[_msgSender()] = _balances[_msgSender()].add(amount);
    TokensTransfer.transferTokens(stakingToken, _msgSender(), address(this), amount);
    emit Staked(_msgSender(), amount);
  }

  function withdraw(uint256 amount) public nonReentrant {
    require(amount > 0, "Cannot withdraw 0");
    require(amount <= _balances[_msgSender()], "Insufficient balance");

    uint256 fees = amount.mul(vaultParamValue("C")).div(10 ** settings.decimals());
    uint256 netAmount = amount.sub(fees);

    _totalSupply = _totalSupply.sub(amount);
    _balances[_msgSender()] = _balances[_msgSender()].sub(amount);

    TokensTransfer.transferTokens(stakingToken, address(this), _msgSender(), netAmount);
    if (fees > 0) {
      TokensTransfer.transferTokens(stakingToken, address(this), settings.treasury(), fees);
    }

    emit Withdrawn(_msgSender(), fees, netAmount);
  }

  function exit() external {
    withdraw(_balances[_msgSender()]);
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function updateVaultParamValue(bytes32 param, uint256 value) external nonReentrant onlyOwner {
    require(settings.isValidParam(param, value), "Invalid param or value");

    _vaultParamsSet[param] = true;
    _vaultParams[param] = value;
    emit UpdateVaultParamValue(param, value);
  }

  /**
   * Rescue tokens that are accidently sent to this contract
   */
  function rescue(address token, address recipient) external nonReentrant onlyOwner {
    require(token != address(0) && recipient != address(0), "Zero address detected");

    uint256 balance;
    if (token == Constants.NATIVE_TOKEN) {
      balance = address(this).balance;
    }
    else {
      balance = IERC20(token).balanceOf(address(this));
    }
    
    uint256 amount = balance;
    if (token == stakingToken) {
      amount = amount.sub(_totalSupply);
    }
    require(amount > 0, "No tokens to rescue");

    TokensTransfer.transferTokens(token, address(this), recipient, amount);
    emit TokenRescued(token, recipient, amount);
  }


  /* ========== EVENTS ========== */

  event Staked(address indexed user, uint256 amount);
  event Withdrawn(address indexed user, uint256 fees, uint256 netAmount);
  event TokenRescued(address indexed token, address indexed recipient, uint256 amount);
  event UpdateVaultParamValue(bytes32 indexed param, uint256 value);
}
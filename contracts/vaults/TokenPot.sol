// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../settings/ProtocolOwner.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IZooProtocol.sol";

contract TokenPot is Context, ReentrancyGuard {

  IProtocolSettings public immutable settings;
  address public immutable owner;
  IZooProtocol public immutable protocol;

  constructor(address _protocol, address _settings) {
    require(_protocol != address(0) && _settings != address(0), "Zero address detected");
    owner = msg.sender;
    settings = IProtocolSettings(_settings);
    protocol = IZooProtocol(_protocol);
  }

  receive() external payable {}

  function balance(address token) public view returns (uint256) {
    if (token == Constants.NATIVE_TOKEN) {
      return address(this).balance;
    }
    else {
      return IERC20(token).balanceOf(address(this));
    }
  }

  // Only owner could withdraw from this contract
  function withdraw(address recipient, address token, uint256 amount) external nonReentrant onlyOwner {
    require(recipient != address(0) && token != address(0), "Zero address detected");
    require(amount > 0 && amount <= balance(token), "Invalid amount");
    TokensTransfer.transferTokens(token, address(this), recipient, amount);
    emit Withdrawn(_msgSender(), recipient, token, amount);
  }

  modifier onlyOwner() {
    require(_msgSender() == owner, "TokenPot: caller is not the owner");
    _;
  }
  /* =============== EVENTS ============= */

  event Withdrawn(address indexed withdrawer, address indexed recipient, address indexed token, uint256 amount);
}

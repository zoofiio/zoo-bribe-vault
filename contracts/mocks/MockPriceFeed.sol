// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed, Ownable, ReentrancyGuard {
  using EnumerableSet for EnumerableSet.AddressSet;

  uint256 internal mockedPrice;

  EnumerableSet.AddressSet internal _testers;

  constructor() {
    _setTester(tx.origin, true);
  }

  function decimals() external pure override returns (uint8) {
    return 8;
  }

  function latestPrice() external view override returns (uint256) {
    return mockedPrice;
  }

  function mockPrice(uint256 _mockPrice) external nonReentrant onlyTester {
    mockedPrice = _mockPrice;
    emit MockedPrice(_msgSender(), _mockPrice);
  }

  /* ================= Testers ================ */

  function getTestersCount() public view returns (uint256) {
    return _testers.length();
  }

  function getTester(uint256 index) public view returns (address) {
    require(index < _testers.length(), "Invalid index");
    return _testers.at(index);
  }

  function isTester(address account) public view returns (bool) {
    return _testers.contains(account);
  }

  function setTester(address account, bool minter) external nonReentrant onlyOwner {
    _setTester(account, minter);
  }

  function _setTester(address account, bool minter) internal {
    require(account != address(0), "Zero address detected");

    if (minter) {
      require(!_testers.contains(account), "Address is already tester");
      _testers.add(account);
    }
    else {
      require(_testers.contains(account), "Address was not tester");
      _testers.remove(account);
    }

    emit UpdateTester(account, minter);
  }

  modifier onlyTester() {
    require(isTester(_msgSender()), "Caller is not tester");
    _;
  }

  /* ========== EVENTS ========== */

  event UpdateTester(address indexed account, bool tester);
  event MockedPrice(address indexed account, uint256 price);
}
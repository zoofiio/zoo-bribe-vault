// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract BriberExtension {
  using EnumerableSet for EnumerableSet.AddressSet;

  EnumerableSet.AddressSet internal _bribers;

  /* ================= VIEWS ================ */

  function getBribersCount() public view returns (uint256) {
    return _bribers.length();
  }

  function getBriber(uint256 index) public view returns (address) {
    require(index < _bribers.length(), "Invalid index");
    return _bribers.at(index);
  }

  function isBriber(address account) public view returns (bool) {
    return _bribers.contains(account);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _setBriber(address account, bool briber) internal {
    if (briber) {
      require(!_bribers.contains(account), "Address is already briber");
      _bribers.add(account);
    }
    else {
      require(_bribers.contains(account), "Address was not briber");
      _bribers.remove(account);
    }

    emit UpdateBriber(account, briber);
  }

  /* =============== EVENTS ============= */

  event UpdateBriber(address indexed account, bool briber);
}
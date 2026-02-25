#include "PlayerCore.h"
#include <atomic>
#include <cmath>
#include <fcntl.h>
#include <iostream>
#include <thread>
#include <unistd.h>
#include <vector>

using namespace player;

std::string stateToString(PlayerState state) {
  switch (state) {
  case PlayerState::Idle:
    return "Idle";
  case PlayerState::Loading:
    return "Loading";
  case PlayerState::Buffering:
    return "Buffering";
  case PlayerState::Playing:
    return "Playing";
  case PlayerState::Paused:
    return "Paused";
  case PlayerState::Stopped:
    return "Stopped";
  case PlayerState::Error:
    return "Error";
  }
  return "Unknown";
}

int main() {
  std::cout << "Starting player Engine with RAW Audio Extraction hook..."
            << std::endl;
  PlayerCore player;

  player.load("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
  player.play();
  std::cout << "Enjoy the true data for 30 seconds..." << std::endl;
  sleep(30);

  std::cout << "\n\nTest completed. Shutting down." << std::endl;
  return 0;
}

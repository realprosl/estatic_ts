#pragma once
#include <chrono>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <string>
#include <vector>
#include <unistd.h>
#include <sys/ioctl.h>

namespace estc {
class Progress;
inline Progress* activeProgress=nullptr;
class Progress {
 using Clock=std::chrono::steady_clock;
 bool verbose_,animated_,drawn_=false;
 std::string label_,detail_;
 Clock::time_point started_=Clock::now(),phase_=started_,last_=started_;
 size_t frame_=0;
 Progress* previous_;
 static long milliseconds(Clock::time_point start){return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-start).count();}
public:
 Progress(bool verbose,bool enabled):verbose_(verbose),previous_(activeProgress){
  auto term=std::getenv("TERM"),ci=std::getenv("CI");
  animated_=enabled&&isatty(STDERR_FILENO)&&!std::getenv("NO_COLOR")&&(!term||std::string(term)!="dumb")&&(!ci||!*ci);
  activeProgress=this;
 }
 ~Progress(){finish(std::uncaught_exceptions()>0);activeProgress=previous_;}
 bool animated()const{return animated_&&!label_.empty();}
 void clear(){if(drawn_){std::cerr<<"\r\x1b[2K"<<std::flush;drawn_=false;}}
 void tick(bool force=false){
  if(!animated()||(!force&&milliseconds(last_)<80))return;
  static const char* frames[]={"⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"};
  winsize window{};size_t width=80;
  if(ioctl(STDERR_FILENO,TIOCGWINSZ,&window)==0&&window.ws_col)width=window.ws_col;
  auto elapsed=milliseconds(phase_);auto suffix=" · "+std::to_string(elapsed/1000)+"."+std::to_string((elapsed%1000)/100)+" s";
  auto text=detail_.empty()?label_:detail_;
  for(char& c:text)if(static_cast<unsigned char>(c)<32||c==127)c=' ';
  // Leave a margin to avoid line wrapping; never split a UTF-8 code point.
  size_t limit=width>suffix.size()+5?width-suffix.size()-5:1;
  std::vector<size_t> points{0};
  for(size_t at=0;at<text.size();){++at;while(at<text.size()&&(static_cast<unsigned char>(text[at])&0xc0)==0x80)++at;points.push_back(at);}
  if(points.size()-1>limit){
   auto left=(limit-1)/2,right=limit-1-left;
   text=text.substr(0,points[left])+"…"+text.substr(points[points.size()-1-right]);
  }
  std::cerr<<"\r\x1b[2K\x1b[36m"<<frames[frame_++%10]<<"\x1b[0m "<<text<<suffix<<std::flush;
  drawn_=true;last_=Clock::now();
 }
 void start(const std::string& label){finish();label_=label;detail_.clear();phase_=Clock::now();frame_=0;if(animated_)tick(true);else if(verbose_)std::cerr<<"> "<<label_<<'\n';}
 void finish(bool failed=false){
  if(label_.empty())return;clear();
  if((animated_&&failed)||(!animated_&&verbose_)){if(animated_)std::cerr<<(failed?"\x1b[31m":"\x1b[32m");std::cerr<<(failed?"✗":"✓");if(animated_)std::cerr<<"\x1b[0m";std::cerr<<' '<<label_<<" ("<<milliseconds(phase_)<<" ms)\n";}
  label_.clear();
 }
 void detail(const std::string& text){
  if(!verbose_)return;
  if(animated_){detail_=text;tick(true);}else std::cerr<<"  "<<text<<'\n';
 }
 void summary(){finish();if(verbose_||animated_)std::cerr<<"✓ Compilación completada ("<<milliseconds(started_)<<" ms)\n";}
};
inline void progressStart(const std::string& label){if(activeProgress)activeProgress->start(label);}
inline void progressDetail(const std::string& text){if(activeProgress)activeProgress->detail(text);}
}
